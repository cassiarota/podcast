use std::path::PathBuf;

use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::now_secs;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub source_format: String,
    pub page_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct Section {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub ord: i64,
}

#[derive(Debug, Serialize)]
pub struct Page {
    pub id: String,
    pub book_id: String,
    pub section_id: String,
    pub page_index: i64,
    pub content: String,
    pub source_offset: i64,
    pub source_len: i64,
}

#[derive(Debug, Serialize)]
pub struct ReadingPosition {
    pub book_id: String,
    pub section_id: String,
    pub page_index: i64,
    pub source_offset: i64,
    pub percent: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReaderSettings {
    #[serde(rename = "fontSize")]
    pub font_size: String,
    pub background: String,
    pub brightness: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TtsSettings {
    pub engine: String,
    pub voice: String,
    pub language: String,
    pub speed: f64,
}

impl Default for TtsSettings {
    fn default() -> Self {
        Self {
            engine: default_engine().to_string(),
            voice: default_voice_for("kokoro").to_string(),
            language: "en".into(),
            speed: 1.0,
        }
    }
}

fn default_engine() -> &'static str {
    // Sensible default: Kokoro everywhere. Windows users who want Qwen can
    // switch in Settings. This was previously hardcoded to qwen on Windows,
    // but Kokoro avoids the CUDA install pain and supports Chinese.
    "kokoro"
}

pub fn default_voice_for(engine: &str) -> &'static str {
    match engine {
        "kokoro" => "af_heart",
        "qwen" => "default",
        _ => "default",
    }
}

#[derive(Debug, Serialize)]
pub struct EngineInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub languages: Vec<LanguageInfo>,
    pub voices: Vec<VoiceInfo>,
}

#[derive(Debug, Serialize)]
pub struct LanguageInfo {
    pub code: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct VoiceInfo {
    pub id: String,
    pub label: String,
    pub language: String,
}

#[tauri::command]
pub fn import_book(
    state: State<AppState>,
    path: String,
    generate_audio: Option<bool>,
) -> Result<Book, String> {
    let _ = generate_audio; // honored by start_tts_job after import; left for future wiring
    let p = PathBuf::from(&path);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    let conn = state.db.lock();
    let book_id = match ext.as_deref() {
        Some("txt") => crate::import_txt::import_txt_at_path(&conn, &p),
        Some("epub") => crate::import_epub::import_epub_at_path(&conn, &p),
        Some(other) => Err(anyhow::anyhow!("unsupported file type: {other}")),
        None => Err(anyhow::anyhow!("file has no extension")),
    }
    .map_err(|e| format!("{e:#}"))?;

    let book = load_book(&conn, &book_id).map_err(|e| format!("{e:#}"))?;
    Ok(book)
}

#[tauri::command]
pub fn list_books(state: State<AppState>) -> Result<Vec<Book>, String> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, author, source_format, page_count, created_at FROM books ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Book {
                id: r.get(0)?,
                title: r.get(1)?,
                author: r.get(2)?,
                source_format: r.get(3)?,
                page_count: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct OpenBookResponse {
    pub book: Book,
    pub sections: Vec<Section>,
}

#[tauri::command]
pub fn open_book(state: State<AppState>, book_id: String) -> Result<OpenBookResponse, String> {
    let conn = state.db.lock();
    let book = load_book(&conn, &book_id).map_err(|e| format!("{e:#}"))?;
    let mut stmt = conn
        .prepare("SELECT id, book_id, title, ord FROM sections WHERE book_id = ?1 ORDER BY ord")
        .map_err(|e| e.to_string())?;
    let sections = stmt
        .query_map(params![book_id], |r| {
            Ok(Section {
                id: r.get(0)?,
                book_id: r.get(1)?,
                title: r.get(2)?,
                ord: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(OpenBookResponse { book, sections })
}

#[tauri::command]
pub fn get_page(
    state: State<AppState>,
    book_id: String,
    page_index: i64,
) -> Result<Option<Page>, String> {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT id, book_id, section_id, page_index, content, source_offset, source_len
         FROM pages WHERE book_id = ?1 AND page_index = ?2",
        params![book_id, page_index],
        |r| {
            Ok(Page {
                id: r.get(0)?,
                book_id: r.get(1)?,
                section_id: r.get(2)?,
                page_index: r.get(3)?,
                content: r.get(4)?,
                source_offset: r.get(5)?,
                source_len: r.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn first_page_of_section(
    state: State<AppState>,
    book_id: String,
    section_id: String,
) -> Result<i64, String> {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT MIN(page_index) FROM pages WHERE book_id = ?1 AND section_id = ?2",
        params![book_id, section_id],
        |r| r.get::<_, Option<i64>>(0),
    )
    .map_err(|e| e.to_string())
    .map(|opt| opt.unwrap_or(0))
}

#[tauri::command]
pub fn get_reading_position(
    state: State<AppState>,
    book_id: String,
) -> Result<Option<ReadingPosition>, String> {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT book_id, section_id, page_index, source_offset, percent FROM reading_positions WHERE book_id = ?1",
        params![book_id],
        |r| {
            Ok(ReadingPosition {
                book_id: r.get(0)?,
                section_id: r.get(1)?,
                page_index: r.get(2)?,
                source_offset: r.get(3)?,
                percent: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_reading_position(
    state: State<AppState>,
    book_id: String,
    section_id: String,
    page_index: i64,
    source_offset: i64,
    percent: f64,
) -> Result<(), String> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO reading_positions (book_id, section_id, page_index, source_offset, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(book_id) DO UPDATE SET
            section_id = excluded.section_id,
            page_index = excluded.page_index,
            source_offset = excluded.source_offset,
            percent = excluded.percent,
            updated_at = excluded.updated_at",
        params![book_id, section_id, page_index, source_offset, percent, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_reader_settings(state: State<AppState>) -> Result<ReaderSettings, String> {
    let conn = state.db.lock();
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'reader'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match value {
        Some(v) => serde_json::from_str::<ReaderSettings>(&v).map_err(|e| e.to_string()),
        None => Ok(ReaderSettings {
            font_size: "medium".into(),
            background: "warm-paper".into(),
            brightness: 1.0,
        }),
    }
}

#[tauri::command]
pub fn save_reader_settings(
    state: State<AppState>,
    settings: ReaderSettings,
) -> Result<(), String> {
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('reader', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_tts_settings(state: State<AppState>) -> Result<TtsSettings, String> {
    let conn = state.db.lock();
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'tts'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(match value {
        Some(v) => serde_json::from_str::<TtsSettings>(&v).unwrap_or_default(),
        None => TtsSettings::default(),
    })
}

#[tauri::command]
pub fn save_tts_settings(
    state: State<AppState>,
    settings: TtsSettings,
) -> Result<(), String> {
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('tts', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_engines() -> Result<Vec<EngineInfo>, String> {
    Ok(vec![
        EngineInfo {
            id: "kokoro".into(),
            label: "Kokoro 82M".into(),
            description: "本地 CPU 运行，多语言（含中文）。推荐。".into(),
            languages: kokoro_languages(),
            voices: kokoro_voices(),
        },
        EngineInfo {
            id: "qwen".into(),
            label: "Qwen TTS (Windows + CUDA)".into(),
            description: "仅 Windows + NVIDIA GPU。需手动放置 D:\\models\\Qwen3-TTS-*".into(),
            languages: vec![
                LanguageInfo { code: "en".into(), label: "English".into() },
                LanguageInfo { code: "zh".into(), label: "中文 (Mandarin)".into() },
            ],
            voices: vec![
                VoiceInfo { id: "default".into(), label: "Default".into(), language: "en".into() },
            ],
        },
        EngineInfo {
            id: "stub".into(),
            label: "Stub (调试)".into(),
            description: "正弦波合成，仅用于打通流程和离线演示。".into(),
            languages: vec![
                LanguageInfo { code: "en".into(), label: "English".into() },
            ],
            voices: vec![
                VoiceInfo { id: "default".into(), label: "Default".into(), language: "en".into() },
            ],
        },
    ])
}

fn kokoro_languages() -> Vec<LanguageInfo> {
    vec![
        LanguageInfo { code: "en".into(), label: "English (American)".into() },
        LanguageInfo { code: "en-GB".into(), label: "English (British)".into() },
        LanguageInfo { code: "zh".into(), label: "中文 (Mandarin)".into() },
        LanguageInfo { code: "ja".into(), label: "日本語".into() },
        LanguageInfo { code: "es".into(), label: "Español".into() },
        LanguageInfo { code: "fr".into(), label: "Français".into() },
        LanguageInfo { code: "hi".into(), label: "हिन्दी".into() },
        LanguageInfo { code: "it".into(), label: "Italiano".into() },
        LanguageInfo { code: "pt-BR".into(), label: "Português (Brasil)".into() },
    ]
}

fn kokoro_voices() -> Vec<VoiceInfo> {
    let voices = [
        // American English (female)
        ("af_heart", "Heart", "en"), ("af_bella", "Bella", "en"),
        ("af_sky", "Sky", "en"), ("af_sarah", "Sarah", "en"),
        ("af_nicole", "Nicole", "en"), ("af_nova", "Nova", "en"),
        ("af_river", "River", "en"), ("af_alloy", "Alloy", "en"),
        ("af_aoede", "Aoede", "en"), ("af_jessica", "Jessica", "en"),
        ("af_kore", "Kore", "en"),
        // American English (male)
        ("am_adam", "Adam", "en"), ("am_echo", "Echo", "en"),
        ("am_eric", "Eric", "en"), ("am_fenrir", "Fenrir", "en"),
        ("am_liam", "Liam", "en"), ("am_michael", "Michael", "en"),
        ("am_onyx", "Onyx", "en"), ("am_puck", "Puck", "en"),
        ("am_santa", "Santa", "en"),
        // British English
        ("bf_alice", "Alice", "en-GB"), ("bf_emma", "Emma", "en-GB"),
        ("bf_isabella", "Isabella", "en-GB"), ("bf_lily", "Lily", "en-GB"),
        ("bm_daniel", "Daniel", "en-GB"), ("bm_fable", "Fable", "en-GB"),
        ("bm_george", "George", "en-GB"), ("bm_lewis", "Lewis", "en-GB"),
        // Mandarin Chinese
        ("zf_xiaobei", "晓贝", "zh"), ("zf_xiaoni", "晓妮", "zh"),
        ("zf_xiaoxiao", "晓晓", "zh"), ("zf_xiaoyi", "晓伊", "zh"),
        ("zm_yunjian", "云健", "zh"), ("zm_yunxi", "云希", "zh"),
        ("zm_yunxia", "云夏", "zh"), ("zm_yunyang", "云扬", "zh"),
        // Japanese
        ("jf_alpha", "Alpha", "ja"), ("jf_gongitsune", "Gongitsune", "ja"),
        ("jf_nezumi", "Nezumi", "ja"), ("jf_tebukuro", "Tebukuro", "ja"),
        ("jm_kumo", "Kumo", "ja"),
        // Spanish
        ("ef_dora", "Dora", "es"), ("em_alex", "Alex", "es"), ("em_santa", "Santa", "es"),
        // French
        ("ff_siwis", "Siwis", "fr"),
        // Hindi
        ("hf_alpha", "Alpha", "hi"), ("hf_beta", "Beta", "hi"),
        ("hm_omega", "Omega", "hi"), ("hm_psi", "Psi", "hi"),
        // Italian
        ("if_sara", "Sara", "it"), ("im_nicola", "Nicola", "it"),
        // Brazilian Portuguese
        ("pf_dora", "Dora", "pt-BR"), ("pm_alex", "Alex", "pt-BR"),
        ("pm_santa", "Santa", "pt-BR"),
    ];
    voices
        .iter()
        .map(|(id, label, lang)| VoiceInfo {
            id: (*id).to_string(),
            label: (*label).to_string(),
            language: (*lang).to_string(),
        })
        .collect()
}

fn load_book(conn: &rusqlite::Connection, book_id: &str) -> Result<Book> {
    let book = conn.query_row(
        "SELECT id, title, author, source_format, page_count, created_at FROM books WHERE id = ?1",
        params![book_id],
        |r| {
            Ok(Book {
                id: r.get(0)?,
                title: r.get(1)?,
                author: r.get(2)?,
                source_format: r.get(3)?,
                page_count: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )?;
    Ok(book)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tts_settings_defaults_are_sensible() {
        let s = TtsSettings::default();
        assert_eq!(s.engine, "kokoro");
        assert_eq!(s.voice, "af_heart");
        assert_eq!(s.language, "en");
        assert!((s.speed - 1.0).abs() < 1e-6);
    }

    #[test]
    fn tts_settings_json_roundtrip() {
        let s = TtsSettings {
            engine: "qwen".into(),
            voice: "default".into(),
            language: "zh".into(),
            speed: 1.25,
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: TtsSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.engine, "qwen");
        assert_eq!(back.language, "zh");
        assert!((back.speed - 1.25).abs() < 1e-6);
    }

    #[test]
    fn default_voice_for_returns_sensible_values() {
        assert_eq!(default_voice_for("kokoro"), "af_heart");
        assert_eq!(default_voice_for("qwen"), "default");
        assert_eq!(default_voice_for("anything-else"), "default");
    }

    #[test]
    fn kokoro_voices_include_chinese_options() {
        let voices = kokoro_voices();
        let chinese: Vec<_> = voices.iter().filter(|v| v.language == "zh").collect();
        assert!(chinese.len() >= 8, "expected ≥8 Chinese voices, got {}", chinese.len());
        assert!(chinese.iter().any(|v| v.id == "zf_xiaoxiao"));
        assert!(chinese.iter().any(|v| v.id == "zm_yunxi"));
    }

    #[test]
    fn kokoro_languages_include_chinese() {
        let langs = kokoro_languages();
        assert!(langs.iter().any(|l| l.code == "zh"));
        assert!(langs.iter().any(|l| l.code == "en"));
        assert!(langs.iter().any(|l| l.code == "ja"));
    }
}
