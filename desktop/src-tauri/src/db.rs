use std::path::Path;

use anyhow::Result;
use rusqlite::Connection;

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS books (
            id              TEXT PRIMARY KEY,
            title           TEXT NOT NULL,
            author          TEXT,
            source_format   TEXT NOT NULL,
            source_path     TEXT,
            source_hash     TEXT,
            page_count      INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sections (
            id              TEXT PRIMARY KEY,
            book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            title           TEXT NOT NULL DEFAULT '',
            ord             INTEGER NOT NULL,
            source_offset   INTEGER NOT NULL DEFAULT 0,
            source_len      INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS sections_book ON sections(book_id, ord);

        CREATE TABLE IF NOT EXISTS pages (
            id              TEXT PRIMARY KEY,
            book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            section_id      TEXT NOT NULL,
            page_index      INTEGER NOT NULL,
            text_hash       TEXT NOT NULL,
            content         TEXT NOT NULL,
            source_offset   INTEGER NOT NULL DEFAULT 0,
            source_len      INTEGER NOT NULL DEFAULT 0,
            UNIQUE(book_id, page_index)
        );
        CREATE INDEX IF NOT EXISTS pages_section ON pages(book_id, section_id);

        CREATE TABLE IF NOT EXISTS reading_positions (
            book_id         TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
            section_id      TEXT NOT NULL,
            page_index      INTEGER NOT NULL,
            source_offset   INTEGER NOT NULL DEFAULT 0,
            percent         REAL NOT NULL DEFAULT 0,
            updated_at      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tts_jobs (
            id              TEXT PRIMARY KEY,
            book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            scope           TEXT NOT NULL,
            status          TEXT NOT NULL,
            progress        REAL NOT NULL DEFAULT 0,
            engine          TEXT NOT NULL,
            voice_preset    TEXT NOT NULL,
            error           TEXT,
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audio_chunks (
            id              TEXT PRIMARY KEY,
            book_id         TEXT NOT NULL,
            page_id         TEXT,
            section_id      TEXT,
            cache_key       TEXT NOT NULL UNIQUE,
            path            TEXT NOT NULL,
            duration_ms     INTEGER NOT NULL DEFAULT 0,
            engine          TEXT NOT NULL,
            voice_preset    TEXT NOT NULL,
            text_hash       TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS audio_chunks_book ON audio_chunks(book_id);

        CREATE TABLE IF NOT EXISTS settings (
            key             TEXT PRIMARY KEY,
            value           TEXT NOT NULL
        );

        -- Usage tracking: every span of time the user spends doing something
        -- with the app. `kind` is "app" (foreground), "reading" (a book open
        -- in the reader), or "playing" (audio actively playing). `book_id`
        -- is null for kind="app".
        CREATE TABLE IF NOT EXISTS usage_sessions (
            id              TEXT PRIMARY KEY,
            kind            TEXT NOT NULL,
            book_id         TEXT,
            started_at      INTEGER NOT NULL,
            ended_at        INTEGER,
            duration_ms     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS usage_sessions_kind_day ON usage_sessions(kind, started_at);
        CREATE INDEX IF NOT EXISTS usage_sessions_book ON usage_sessions(book_id);

        -- User-saved notes (highlights). Created when the user taps a
        -- sentence in the reader and picks 📝 笔记.
        CREATE TABLE IF NOT EXISTS notes (
            id              TEXT PRIMARY KEY,
            book_id         TEXT NOT NULL,
            page_id         TEXT,
            sentence_index  INTEGER,
            text            TEXT NOT NULL,
            created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notes_book ON notes(book_id, created_at);
        "#,
    )?;
    Ok(())
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
    }

    #[test]
    fn migrations_create_expected_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let names: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        for required in [
            "audio_chunks",
            "books",
            "pages",
            "reading_positions",
            "sections",
            "settings",
            "tts_jobs",
        ] {
            assert!(names.contains(&required.to_string()), "missing table {required}");
        }
    }

    #[test]
    fn now_secs_is_recent() {
        let t = now_secs();
        // Loose bounds: between 2025-01-01 (1735689600) and 2030-01-01 (1893456000).
        assert!(t > 1_735_000_000);
        assert!(t < 2_000_000_000);
    }
}
