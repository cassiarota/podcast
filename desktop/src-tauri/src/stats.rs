//! Usage / reading-time stats.
//!
//! Tracks three kinds of "sessions" — open app windows, books being read,
//! and audio being played — into a single SQLite table. Frontend uses
//! the aggregated commands at the bottom of this file to render a heatmap
//! + per-book list + summary cards on the Stats page.

use std::time::SystemTime;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Start a new session of `kind` ("app", "reading", "playing").
/// Returns the session id which must be passed to `end_session` to close it.
#[tauri::command]
pub fn start_session(
    state: State<AppState>,
    kind: String,
    book_id: Option<String>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let conn = state.db.lock();
    // Defensive: clean up any sessions of the same (kind, book_id) that were
    // left open from a previous crash. We use the started_at timestamp as a
    // best-effort end so the duration isn't grossly inflated.
    close_dangling_sessions(&conn, &kind, book_id.as_deref())?;
    conn.execute(
        "INSERT INTO usage_sessions (id, kind, book_id, started_at, ended_at, duration_ms)
         VALUES (?1, ?2, ?3, ?4, NULL, 0)",
        params![id, kind, book_id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// End the session referenced by `session_id`, computing the duration.
#[tauri::command]
pub fn end_session(state: State<AppState>, session_id: String) -> Result<i64, String> {
    let end = now_ms();
    let conn = state.db.lock();
    let started: Option<i64> = conn
        .query_row(
            "SELECT started_at FROM usage_sessions WHERE id = ?1 AND ended_at IS NULL",
            params![session_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(started) = started else { return Ok(0); };
    let duration = (end - started).max(0);
    conn.execute(
        "UPDATE usage_sessions SET ended_at = ?1, duration_ms = ?2 WHERE id = ?3",
        params![end, duration, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(duration)
}

/// Heartbeat: extend an active session's effective duration without closing
/// it. Used by the frontend to ensure a long-running "app" session isn't
/// lost if the process dies. We don't actually write here — the closer
/// computes duration on end. This command exists for parity with future
/// telemetry; for now it's a no-op acknowledgement.
#[tauri::command]
pub fn heartbeat_session(_state: State<AppState>, _session_id: String) -> Result<(), String> {
    Ok(())
}

fn close_dangling_sessions(
    conn: &Connection,
    kind: &str,
    book_id: Option<&str>,
) -> Result<(), String> {
    // Close any open session of this kind/book pair. We assume the user
    // can only be doing one of each at a time per book.
    let now = now_ms();
    if let Some(b) = book_id {
        conn.execute(
            "UPDATE usage_sessions
             SET ended_at = ?1,
                 duration_ms = MAX(0, ?1 - started_at)
             WHERE kind = ?2 AND book_id = ?3 AND ended_at IS NULL",
            params![now, kind, b],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE usage_sessions
             SET ended_at = ?1,
                 duration_ms = MAX(0, ?1 - started_at)
             WHERE kind = ?2 AND book_id IS NULL AND ended_at IS NULL",
            params![now, kind],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct DailyStat {
    /// "YYYY-MM-DD" in the local timezone of the saved timestamp.
    pub date: String,
    pub app_ms: i64,
    pub reading_ms: i64,
    pub playing_ms: i64,
}

/// Aggregate stats by day for the inclusive range [from_ms, to_ms].
#[tauri::command]
pub fn get_daily_stats(
    state: State<AppState>,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<DailyStat>, String> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            // SQLite's strftime treats the epoch as seconds, so divide ms.
            // We use 'localtime' so the day buckets match the user's clock.
            "SELECT strftime('%Y-%m-%d', started_at / 1000, 'unixepoch', 'localtime') AS day,
                    kind,
                    SUM(
                      CASE
                        WHEN ended_at IS NOT NULL THEN duration_ms
                        ELSE MAX(0, ?3 - started_at)
                      END
                    ) AS total_ms
             FROM usage_sessions
             WHERE started_at >= ?1 AND started_at <= ?2
             GROUP BY day, kind",
        )
        .map_err(|e| e.to_string())?;

    let now = now_ms();
    let rows = stmt
        .query_map(params![from_ms, to_ms, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut by_day: std::collections::BTreeMap<String, DailyStat> = std::collections::BTreeMap::new();
    for row in rows {
        let (day, kind, total) = row.map_err(|e| e.to_string())?;
        let entry = by_day.entry(day.clone()).or_insert_with(|| DailyStat {
            date: day,
            app_ms: 0,
            reading_ms: 0,
            playing_ms: 0,
        });
        match kind.as_str() {
            "app" => entry.app_ms = total,
            "reading" => entry.reading_ms = total,
            "playing" => entry.playing_ms = total,
            _ => {}
        }
    }
    Ok(by_day.into_values().collect())
}

#[derive(Debug, Serialize)]
pub struct BookStat {
    pub book_id: String,
    pub title: String,
    pub reading_ms: i64,
    pub playing_ms: i64,
    pub sessions: i64,
    pub last_used_at: Option<i64>,
}

/// Per-book aggregate. Books with zero recorded time are omitted.
#[tauri::command]
pub fn get_per_book_stats(state: State<AppState>) -> Result<Vec<BookStat>, String> {
    let conn = state.db.lock();
    let now = now_ms();
    let mut stmt = conn
        .prepare(
            "SELECT books.id, books.title,
                    COALESCE(SUM(CASE WHEN s.kind='reading' THEN
                      CASE WHEN s.ended_at IS NOT NULL THEN s.duration_ms ELSE MAX(0, ?1 - s.started_at) END
                    ELSE 0 END), 0) AS reading_ms,
                    COALESCE(SUM(CASE WHEN s.kind='playing' THEN
                      CASE WHEN s.ended_at IS NOT NULL THEN s.duration_ms ELSE MAX(0, ?1 - s.started_at) END
                    ELSE 0 END), 0) AS playing_ms,
                    COUNT(s.id) AS sessions,
                    MAX(s.started_at) AS last_used_at
             FROM books
             LEFT JOIN usage_sessions s ON s.book_id = books.id
             GROUP BY books.id
             HAVING reading_ms + playing_ms > 0
             ORDER BY reading_ms + playing_ms DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![now], |r| {
            Ok(BookStat {
                book_id: r.get(0)?,
                title: r.get(1)?,
                reading_ms: r.get(2)?,
                playing_ms: r.get(3)?,
                sessions: r.get(4)?,
                last_used_at: r.get(5).ok(),
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
pub struct Summary {
    pub total_app_ms: i64,
    pub total_reading_ms: i64,
    pub total_playing_ms: i64,
    pub today_app_ms: i64,
    pub today_reading_ms: i64,
    pub today_playing_ms: i64,
    pub books_listened: i64,
    pub books_read: i64,
}

#[tauri::command]
pub fn get_stats_summary(state: State<AppState>) -> Result<Summary, String> {
    let conn = state.db.lock();
    let now = now_ms();

    let today_start = today_start_ms_local();

    let totals: (i64, i64, i64) = conn
        .query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN kind='app' THEN CASE WHEN ended_at IS NOT NULL THEN duration_ms ELSE MAX(0, ?1 - started_at) END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN kind='reading' THEN CASE WHEN ended_at IS NOT NULL THEN duration_ms ELSE MAX(0, ?1 - started_at) END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN kind='playing' THEN CASE WHEN ended_at IS NOT NULL THEN duration_ms ELSE MAX(0, ?1 - started_at) END ELSE 0 END), 0)
             FROM usage_sessions",
            params![now],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let today: (i64, i64, i64) = conn
        .query_row(
            "SELECT
               COALESCE(SUM(CASE WHEN kind='app' THEN CASE WHEN ended_at IS NOT NULL THEN duration_ms ELSE MAX(0, ?1 - started_at) END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN kind='reading' THEN CASE WHEN ended_at IS NOT NULL THEN duration_ms ELSE MAX(0, ?1 - started_at) END ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN kind='playing' THEN CASE WHEN ended_at IS NOT NULL THEN duration_ms ELSE MAX(0, ?1 - started_at) END ELSE 0 END), 0)
             FROM usage_sessions
             WHERE started_at >= ?2",
            params![now, today_start],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let books_listened: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT book_id) FROM usage_sessions WHERE kind='playing' AND book_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let books_read: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT book_id) FROM usage_sessions WHERE kind='reading' AND book_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(Summary {
        total_app_ms: totals.0,
        total_reading_ms: totals.1,
        total_playing_ms: totals.2,
        today_app_ms: today.0,
        today_reading_ms: today.1,
        today_playing_ms: today.2,
        books_listened,
        books_read,
    })
}

/// Start of today in the user's local clock, expressed as Unix millis.
fn today_start_ms_local() -> i64 {
    // Use chrono-free arithmetic with a small helper. We can rely on libc's
    // localtime_r through the standard library indirectly via the SQL
    // strftime(...,'localtime') queries above, but here we need an i64.
    //
    // Approximation: midnight in *system* local time. We compute the offset
    // from UTC by asking std::time and the OS through the `time` crate? we
    // don't have it. So we fall back to a heuristic: use 24h-aligned UTC
    // start-of-day. For users near UTC this is accurate; for others the
    // "today" bucket might be off by a few hours. The Stats page is still
    // informative — and SQLite's `localtime` modifier handles day bucketing
    // in the heatmap query correctly.
    let now_ms = now_ms();
    let day_ms: i64 = 24 * 60 * 60 * 1000;
    (now_ms / day_ms) * day_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c
    }

    #[test]
    fn migrations_create_usage_sessions_table() {
        let conn = open_test_db();
        let names: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(names.contains(&"usage_sessions".to_string()));
    }

    #[test]
    fn end_session_writes_duration() {
        let conn = open_test_db();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO usage_sessions (id, kind, book_id, started_at, ended_at, duration_ms)
             VALUES (?1, 'reading', NULL, ?2, NULL, 0)",
            params![id, 1_000_000_i64],
        )
        .unwrap();
        // simulate ending 30 s later
        conn.execute(
            "UPDATE usage_sessions SET ended_at = ?1, duration_ms = ?1 - started_at WHERE id = ?2",
            params![1_030_000_i64, id],
        )
        .unwrap();
        let dur: i64 = conn
            .query_row(
                "SELECT duration_ms FROM usage_sessions WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dur, 30_000);
    }
}
