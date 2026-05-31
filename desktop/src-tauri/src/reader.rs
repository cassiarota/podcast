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
