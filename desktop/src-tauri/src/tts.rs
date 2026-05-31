use std::time::Duration;

use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, State, Window};
use uuid::Uuid;

use crate::cache;
use crate::db::now_secs;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct TtsJob {
    pub id: String,
    pub book_id: String,
    pub scope: String,
    pub status: String,
    pub progress: f64,
    pub engine: String,
    pub voice_preset: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AudioChunk {
    pub id: String,
    pub page_id: Option<String>,
    pub cache_key: String,
    pub path: String,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct TtsStatus {
    pub sidecar_running: bool,
    pub engine_loaded: bool,
    pub engine: Option<String>,
    pub idle_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct SidecarReady {
    loaded: bool,
    engine: Option<String>,
    idle_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct SidecarSynthResult {
    duration_ms: i64,
    cache_key: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct SidecarErrorBody {
    reason: String,
    message: Option<String>,
}

#[tauri::command]
pub async fn start_tts_job(
    state: State<'_, AppState>,
    window: Window,
    book_id: String,
    scope: String,
    voice_preset: String,
) -> Result<TtsJob, String> {
    state.sidecar.ensure_running().await.map_err(|e| e.to_string())?;
    // Read the user-saved settings; engine override + language + speed all
    // come from here instead of the old platform-hardcoded value.
    let tts_settings = crate::reader::get_tts_settings(state.clone())
        .unwrap_or_else(|_| crate::reader::TtsSettings::default());
    let engine = tts_settings.engine.clone();
    let language_for_task = tts_settings.language.clone();
    let speed_for_task = tts_settings.speed as f32;
    // The voice from the play form takes precedence, but if the caller
    // sends an empty string we fall back to the saved preset.
    let voice_for_task = if voice_preset.is_empty() {
        tts_settings.voice.clone()
    } else {
        voice_preset.clone()
    };
    let job_id = Uuid::new_v4().to_string();
    let now = now_secs();

    {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO tts_jobs (id, book_id, scope, status, progress, engine, voice_preset, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'queued', 0, ?4, ?5, ?6, ?6)",
            params![job_id, book_id, scope, engine, voice_preset, now],
        )
        .map_err(|e| e.to_string())?;
    }

    let pages = {
        let conn = state.db.lock();
        load_pages_for_scope(&conn, &book_id, &scope).map_err(|e| e.to_string())?
    };

    let total = pages.len();
    let port = state.sidecar.port();
    let audio_dir = state.sidecar.audio_cache_dir();
    // voice_for_task already resolved above from saved settings.

    let db = state.db.clone();
    let job_id_task = job_id.clone();
    let engine_task = engine.clone();
    let window_clone = window.clone();
    let book_id_task = book_id.clone();

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .unwrap();
        let mut done = 0usize;
        for (page_id, text) in &pages {
            // Check for cancellation each iteration.
            let cancelled: bool = {
                let conn = db.lock();
                conn.query_row(
                    "SELECT status FROM tts_jobs WHERE id = ?1",
                    params![job_id_task],
                    |r| r.get::<_, String>(0),
                )
                .map(|s| s == "cancelled")
                .unwrap_or(false)
            };
            if cancelled {
                break;
            }

            let text_hash = hex::encode(Sha256::digest(text.as_bytes()));
            let key = cache::cache_key(&text_hash, &engine_task, &voice_for_task, &language_for_task, speed_for_task);
            let path = cache::cache_path(&audio_dir, &key);
            if !path.exists() {
                let req = serde_json::json!({
                    "text": text,
                    "engine": engine_task,
                    "voice": voice_for_task,
                    "language": language_for_task,
                    "speed": speed_for_task,
                    "cache_key": key,
                });
                match client
                    .post(format!("http://127.0.0.1:{port}/tts/realtime"))
                    .json(&req)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(body) = resp.json::<SidecarSynthResult>().await {
                            let conn = db.lock();
                            let _ = conn.execute(
                                "INSERT OR REPLACE INTO audio_chunks (id, book_id, page_id, section_id, cache_key, path, duration_ms, engine, voice_preset, text_hash, created_at)
                                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                                params![
                                    Uuid::new_v4().to_string(),
                                    book_id_task,
                                    page_id,
                                    body.cache_key,
                                    body.path,
                                    body.duration_ms,
                                    engine_task,
                                    voice_for_task,
                                    text_hash,
                                    now_secs()
                                ],
                            );
                        }
                    }
                    Ok(resp) => {
                        let err_text = resp.text().await.unwrap_or_default();
                        tracing::warn!("synth failed: {err_text}");
                    }
                    Err(e) => tracing::warn!("synth request failed: {e}"),
                }
            }
            done += 1;
            let progress = if total > 0 { done as f64 / total as f64 } else { 1.0 };
            {
                let conn = db.lock();
                let _ = conn.execute(
                    "UPDATE tts_jobs SET status = 'generating', progress = ?1, updated_at = ?2 WHERE id = ?3 AND status != 'cancelled'",
                    params![progress, now_secs(), job_id_task],
                );
            }
            let _ = window_clone.emit(
                "tts:progress",
                serde_json::json!({
                    "job_id": job_id_task,
                    "book_id": book_id_task,
                    "progress": progress,
                }),
            );
        }
        let final_status = {
            let conn = db.lock();
            let s = conn
                .query_row(
                    "SELECT status FROM tts_jobs WHERE id = ?1",
                    params![job_id_task],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_else(|_| "failed".into());
            if s == "cancelled" {
                "cancelled"
            } else {
                "completed"
            }
            .to_string()
        };
        let conn = db.lock();
        let _ = conn.execute(
            "UPDATE tts_jobs SET status = ?1, progress = 1.0, updated_at = ?2 WHERE id = ?3",
            params![final_status, now_secs(), job_id_task],
        );
        let _ = window_clone.emit(
            "tts:done",
            serde_json::json!({
                "job_id": job_id_task,
                "book_id": book_id_task,
                "status": final_status,
            }),
        );
    });

    Ok(TtsJob {
        id: job_id,
        book_id,
        scope,
        status: "queued".into(),
        progress: 0.0,
        engine,
        voice_preset,
        error: None,
    })
}

#[tauri::command]
pub fn cancel_tts_job(state: State<AppState>, job_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    conn.execute(
        "UPDATE tts_jobs SET status = 'cancelled', updated_at = ?1 WHERE id = ?2",
        params![now_secs(), job_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn play_cached_or_generate(
    state: State<'_, AppState>,
    book_id: String,
    page_id: String,
    voice_preset: String,
) -> Result<AudioChunk, String> {
    // Resolve engine + voice + language + speed from user settings. The
    // voice_preset argument from the UI takes precedence (lets the play
    // button override the saved default for one-off playback), but the
    // saved preset is the fallback.
    let tts_settings = crate::reader::get_tts_settings(state.clone())
        .unwrap_or_else(|_| crate::reader::TtsSettings::default());
    let engine = tts_settings.engine.clone();
    let voice = if voice_preset.is_empty() {
        tts_settings.voice.clone()
    } else {
        voice_preset.clone()
    };
    let language = tts_settings.language.clone();
    let speed = tts_settings.speed as f32;

    // Look up the page's text first.
    let (text, text_hash) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT content, text_hash FROM pages WHERE id = ?1",
            params![page_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("page not found: {e}"))?
    };

    let engine_local = engine.clone();
    let key = cache::cache_key(&text_hash, &engine_local, &voice, &language, speed);
    let _expected_path = cache::cache_path(&state.sidecar.audio_cache_dir(), &key);

    // Cache hit?
    if let Some(existing) = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT id, path, duration_ms FROM audio_chunks WHERE cache_key = ?1",
            params![key],
            |r| {
                Ok(AudioChunk {
                    id: r.get(0)?,
                    page_id: Some(page_id.clone()),
                    cache_key: key.clone(),
                    path: r.get(1)?,
                    duration_ms: r.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    } {
        if std::path::Path::new(&existing.path).exists() {
            return Ok(existing);
        }
    }

    // Cache miss — generate now.
    state.sidecar.ensure_running().await.map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .unwrap();
    let req = serde_json::json!({
        "text": text,
        "engine": engine,
        "voice": voice,
        "language": language,
        "speed": speed,
        "cache_key": key,
    });
    let resp = client
        .post(format!(
            "http://127.0.0.1:{}/tts/realtime",
            state.sidecar.port()
        ))
        .json(&req)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let raw = resp.text().await.unwrap_or_default();
        let summary = parse_sidecar_error(&raw);
        return Err(format!(
            "tts not ready ({status}): {summary}"
        ));
    }
    let body: SidecarSynthResult = resp.json().await.map_err(|e| e.to_string())?;

    let chunk_id = Uuid::new_v4().to_string();
    {
        let conn = state.db.lock();
        conn.execute(
            "INSERT OR REPLACE INTO audio_chunks (id, book_id, page_id, section_id, cache_key, path, duration_ms, engine, voice_preset, text_hash, created_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                chunk_id,
                book_id,
                page_id,
                body.cache_key,
                body.path,
                body.duration_ms,
                engine,
                voice,
                text_hash,
                now_secs()
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(AudioChunk {
        id: chunk_id,
        page_id: Some(page_id),
        cache_key: body.cache_key,
        path: body.path,
        duration_ms: body.duration_ms,
    })
}

#[tauri::command]
pub async fn get_tts_status(state: State<'_, AppState>) -> Result<TtsStatus, String> {
    let running = state.sidecar.is_running();
    if !running {
        return Ok(TtsStatus {
            sidecar_running: false,
            engine_loaded: false,
            engine: None,
            idle_seconds: None,
        });
    }
    let url = format!("http://127.0.0.1:{}/ready", state.sidecar.port());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .unwrap();
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => {
            if let Ok(body) = r.json::<SidecarReady>().await {
                return Ok(TtsStatus {
                    sidecar_running: true,
                    engine_loaded: body.loaded,
                    engine: body.engine,
                    idle_seconds: body.idle_seconds,
                });
            }
        }
        _ => {}
    }
    Ok(TtsStatus {
        sidecar_running: true,
        engine_loaded: false,
        engine: None,
        idle_seconds: None,
    })
}

fn load_pages_for_scope(
    conn: &rusqlite::Connection,
    book_id: &str,
    scope: &str,
) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    if scope == "whole_book" {
        let mut stmt = conn.prepare(
            "SELECT id, content FROM pages WHERE book_id = ?1 ORDER BY page_index",
        )?;
        for row in stmt.query_map(params![book_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            out.push(row?);
        }
    } else if let Some(rest) = scope.strip_prefix("section:") {
        let mut stmt = conn.prepare(
            "SELECT id, content FROM pages WHERE book_id = ?1 AND section_id = ?2 ORDER BY page_index",
        )?;
        for row in stmt.query_map(params![book_id, rest], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            out.push(row?);
        }
    } else if let Some(rest) = scope.strip_prefix("page:") {
        let mut stmt = conn.prepare(
            "SELECT id, content FROM pages WHERE book_id = ?1 AND id = ?2",
        )?;
        for row in stmt.query_map(params![book_id, rest], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            out.push(row?);
        }
    }
    Ok(out)
}

/// Best-effort extraction of a useful message from a sidecar error body.
///
/// The sidecar's NotReadyError handler returns `{reason, message, paths}`.
/// Fallthrough Python exceptions return `{reason, message, traceback}`.
/// FastAPI's validation errors return `{detail: [{loc, msg, type}, ...]}`
/// or `{detail: "..."}` for HTTPException. We try each shape and finally
/// fall back to the raw body so the UI never shows just "unknown".
fn parse_sidecar_error(raw: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        // Our own structured error.
        if let (Some(reason), msg) = (v.get("reason").and_then(|x| x.as_str()), v.get("message").and_then(|x| x.as_str())) {
            return match msg {
                Some(m) if !m.is_empty() => format!("{reason}: {m}"),
                _ => reason.to_string(),
            };
        }
        // FastAPI HTTPException: {"detail": "..."}.
        if let Some(detail) = v.get("detail") {
            if let Some(s) = detail.as_str() {
                return s.to_string();
            }
            // FastAPI validation error: {"detail": [{loc, msg, type}, ...]}.
            if let Some(arr) = detail.as_array() {
                let parts: Vec<String> = arr
                    .iter()
                    .filter_map(|e| {
                        let msg = e.get("msg").and_then(|x| x.as_str())?;
                        let loc = e
                            .get("loc")
                            .and_then(|x| x.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|i| i.to_string())))
                                    .collect::<Vec<_>>()
                                    .join(".")
                            })
                            .unwrap_or_default();
                        Some(format!("{loc}: {msg}"))
                    })
                    .collect();
                if !parts.is_empty() {
                    return parts.join("; ");
                }
            }
        }
    }
    if raw.is_empty() {
        "<empty response body>".into()
    } else {
        raw.chars().take(240).collect::<String>()
    }
}

#[cfg(test)]
mod parse_error_tests {
    use super::parse_sidecar_error;

    #[test]
    fn structured_reason_and_message() {
        let r = parse_sidecar_error(r#"{"reason":"model_path_missing","message":"not found","paths":["/x"]}"#);
        assert_eq!(r, "model_path_missing: not found");
    }

    #[test]
    fn fastapi_validation_error() {
        let r = parse_sidecar_error(r#"{"detail":[{"type":"missing","loc":["query","req"],"msg":"Field required","input":null}]}"#);
        assert!(r.contains("Field required"), "got: {r}");
        assert!(r.contains("req"), "got: {r}");
    }

    #[test]
    fn fastapi_string_detail() {
        let r = parse_sidecar_error(r#"{"detail":"unknown job"}"#);
        assert_eq!(r, "unknown job");
    }

    #[test]
    fn empty_body() {
        assert_eq!(parse_sidecar_error(""), "<empty response body>");
    }

    #[test]
    fn non_json_falls_through_to_raw() {
        let r = parse_sidecar_error("plain text crash");
        assert_eq!(r, "plain text crash");
    }
}
