//! Notes / highlights — user-saved sentences from books.

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct Note {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    pub page_id: Option<String>,
    pub sentence_index: Option<i64>,
    pub page_index: Option<i64>,
    pub text: String,
    pub created_at: i64,
}

#[tauri::command]
pub fn add_note(
    state: State<AppState>,
    book_id: String,
    page_id: Option<String>,
    sentence_index: Option<i64>,
    text: String,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = crate::db::now_secs();
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO notes (id, book_id, page_id, sentence_index, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, book_id, page_id, sentence_index, text, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, note_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    conn.execute("DELETE FROM notes WHERE id = ?1", params![note_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// List notes, optionally filtered by book_id and/or text search.
#[tauri::command]
pub fn list_notes(
    state: State<AppState>,
    book_id: Option<String>,
    search: Option<String>,
) -> Result<Vec<Note>, String> {
    let conn = state.db.lock();
    let mut sql = String::from(
        "SELECT n.id, n.book_id, b.title, n.page_id, n.sentence_index, p.page_index, n.text, n.created_at
         FROM notes n
         LEFT JOIN books b ON b.id = n.book_id
         LEFT JOIN pages p ON p.id = n.page_id
         WHERE 1=1",
    );
    let mut params_dyn: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(b) = book_id {
        sql.push_str(" AND n.book_id = ?");
        params_dyn.push(b.into());
    }
    if let Some(s) = search.as_ref() {
        if !s.is_empty() {
            sql.push_str(" AND n.text LIKE ?");
            params_dyn.push(format!("%{s}%").into());
        }
    }
    sql.push_str(" ORDER BY n.created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_dyn), |r| {
            Ok(Note {
                id: r.get(0)?,
                book_id: r.get(1)?,
                book_title: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                page_id: r.get(3)?,
                sentence_index: r.get(4)?,
                page_index: r.get(5)?,
                text: r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct NotedBook {
    pub book_id: String,
    pub title: String,
    pub note_count: i64,
}

#[tauri::command]
pub fn list_books_with_notes(state: State<AppState>) -> Result<Vec<NotedBook>, String> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.title, COUNT(n.id)
             FROM notes n
             LEFT JOIN books b ON b.id = n.book_id
             GROUP BY b.id
             ORDER BY MAX(n.created_at) DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(NotedBook {
                book_id: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                title: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                note_count: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn notes_table_created() {
        let c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        let names: Vec<String> = c
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(names.contains(&"notes".to_string()));
    }

    /// Make this callable from non-tauri test context.
    fn _check_unused() -> i64 {
        crate::db::now_secs()
    }
}
