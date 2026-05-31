pub mod cache;
pub mod db;
pub mod import_epub;
pub mod import_txt;
pub mod reader;
pub mod sidecar;
pub mod stats;
pub mod tts;

use std::sync::Arc;

use anyhow::Result;
use parking_lot::Mutex;
use rusqlite::Connection;
use sidecar::SidecarState;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub sidecar: Arc<SidecarState>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir must be available");
            std::fs::create_dir_all(&data_dir).ok();
            std::fs::create_dir_all(data_dir.join("audio_cache")).ok();

            let db_path = data_dir.join("library.db");
            let conn = db::open(&db_path)?;
            db::migrate(&conn)?;

            let resource_dir = app.path().resource_dir().ok();
            let sidecar = Arc::new(SidecarState::new(data_dir.clone(), resource_dir));

            // LFS sanity check: warn if Kokoro pointer wasn't pulled.
            if let Some(rd) = sidecar.kokoro_model_path() {
                if let Ok(meta) = std::fs::metadata(&rd) {
                    if meta.len() < 1024 {
                        tracing::warn!(
                            "Kokoro model at {:?} looks like an LFS pointer ({} bytes). \
                             Run `git lfs pull` before generating audio.",
                            rd,
                            meta.len()
                        );
                    }
                }
            }

            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                sidecar: sidecar.clone(),
            });

            // Kick off TTS engine pre-warm in the background. Reads the
            // user's saved TtsSettings (preload toggle + voice/language)
            // from the freshly-opened DB. Non-blocking — the UI renders
            // and books load even while Kokoro is still constructing its
            // pipeline. By the time the user clicks ▶ Play the first time,
            // the engine is usually already warm.
            let app_handle = app.handle().clone();
            let sidecar_for_preload = sidecar.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = preload_engine(app_handle, sidecar_for_preload).await {
                    tracing::warn!("tts preload failed: {e:#}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reader::import_book,
            reader::list_books,
            reader::delete_book,
            reader::open_book,
            reader::get_page,
            reader::first_page_of_section,
            reader::get_reading_position,
            reader::save_reading_position,
            reader::get_reader_settings,
            reader::save_reader_settings,
            reader::get_tts_settings,
            reader::save_tts_settings,
            reader::list_engines,
            tts::start_tts_job,
            tts::cancel_tts_job,
            tts::play_cached_or_generate,
            tts::get_tts_status,
            stats::start_session,
            stats::end_session,
            stats::heartbeat_session,
            stats::get_daily_stats,
            stats::get_per_book_stats,
            stats::get_stats_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn handle_init_error(e: anyhow::Error) -> Result<()> {
    tracing::error!("init error: {e:?}");
    Err(e)
}

/// Background TTS pre-warm. Reads the user's saved TtsSettings and, if
/// preload is enabled, fires a tiny synth request so the Kokoro pipeline
/// (and misaki phonemizer if Chinese) is loaded before the user's first
/// ▶ Play. Failures are logged but never surface to the UI — preload is
/// a best-effort latency optimization.
async fn preload_engine(
    app: tauri::AppHandle,
    sidecar: Arc<SidecarState>,
) -> Result<()> {
    use tauri::Manager;
    // Let the UI render first.
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    let state = app.state::<AppState>();
    let tts = match crate::reader::get_tts_settings(state.clone()) {
        Ok(t) => t,
        Err(e) => return Err(anyhow::anyhow!("read settings: {e}")),
    };
    if !tts.preload {
        tracing::info!("tts preload disabled by user setting");
        return Ok(());
    }
    if tts.engine != "kokoro" {
        // Qwen / stub don't benefit (qwen first-load is GPU-bound anyway,
        // stub is fast).
        return Ok(());
    }

    sidecar.ensure_running().await?;

    let port = sidecar.port();
    let url = format!("http://127.0.0.1:{port}/tts/realtime");
    // Pick a short text in whatever language the user has saved. This
    // triggers KPipeline construction for that lang_code.
    let warm_base = if tts.language.starts_with("zh") || tts.voice.starts_with('z') {
        "你好"
    } else if tts.language.starts_with("ja") || tts.voice.starts_with('j') {
        "こんにちは"
    } else {
        "Hello"
    };
    // Suffix the text with a per-launch nonce so the sidecar's WAV cache
    // doesn't short-circuit the preload back to "already done in 5 ms".
    // Without this the second app launch hits the cached file from the
    // first run and never actually constructs the KPipeline.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let warm_text = format!("{warm_base} preload-{nonce}");
    let req = serde_json::json!({
        "text": warm_text,
        "engine": "kokoro",
        "voice": tts.voice,
        "language": tts.language,
        "speed": tts.speed,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap();
    tracing::info!("tts preload: warming voice={} lang={}", tts.voice, tts.language);
    match client.post(&url).json(&req).send().await {
        Ok(r) if r.status().is_success() => tracing::info!("tts preload: engine warm"),
        Ok(r) => tracing::warn!("tts preload non-success: {}", r.status()),
        Err(e) => tracing::warn!("tts preload request: {e}"),
    }
    Ok(())
}
