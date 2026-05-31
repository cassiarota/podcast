use std::path::Path;

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::now_secs;

const PAGE_BYTES: usize = 1800;

pub fn import_txt_at_path(conn: &Connection, path: &Path) -> Result<String> {
    let raw = std::fs::read(path)?;
    let text = std::str::from_utf8(&raw)
        .map_err(|_| anyhow!("file is not valid UTF-8"))?
        .replace("\r\n", "\n")
        .replace('\r', "\n");

    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let source_hash = hex::encode(Sha256::digest(text.as_bytes()));
    let book_id = Uuid::new_v4().to_string();

    let sections = split_into_sections(&text);

    let mut page_index: i64 = 0;
    let now = now_secs();

    conn.execute(
        "INSERT INTO books (id, title, author, source_format, source_path, source_hash, page_count, created_at)
         VALUES (?1, ?2, NULL, 'txt', ?3, ?4, 0, ?5)",
        params![
            book_id,
            title,
            path.to_string_lossy().to_string(),
            source_hash,
            now
        ],
    )?;

    for (ord, sec) in sections.iter().enumerate() {
        let section_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO sections (id, book_id, title, ord, source_offset, source_len) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![section_id, book_id, sec.title, ord as i64, sec.offset as i64, sec.len as i64],
        )?;

        for chunk in paginate(&sec.body, sec.offset) {
            let page_id = Uuid::new_v4().to_string();
            let text_hash = hex::encode(Sha256::digest(chunk.text.as_bytes()));
            conn.execute(
                "INSERT INTO pages (id, book_id, section_id, page_index, text_hash, content, source_offset, source_len)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    page_id,
                    book_id,
                    section_id,
                    page_index,
                    text_hash,
                    chunk.text,
                    chunk.offset as i64,
                    chunk.len as i64
                ],
            )?;
            page_index += 1;
        }
    }

    conn.execute(
        "UPDATE books SET page_count = ?1 WHERE id = ?2",
        params![page_index, book_id],
    )?;

    Ok(book_id)
}

struct RawSection<'a> {
    title: String,
    body: &'a str,
    offset: usize,
    len: usize,
}

fn split_into_sections(text: &str) -> Vec<RawSection<'_>> {
    let mut out: Vec<RawSection> = Vec::new();
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut cur_start = 0usize;
    let mut cur_title = String::new();

    let mut line_start = 0usize;
    let mut i = 0usize;
    while i <= len {
        let at_end = i == len;
        if at_end || bytes[i] == b'\n' {
            let line = &text[line_start..i];
            let trimmed = line.trim();
            let is_heading = !trimmed.is_empty()
                && trimmed.len() < 80
                && trimmed
                    .chars()
                    .all(|c| !c.is_lowercase());

            if is_heading && i > cur_start {
                let body = &text[cur_start..line_start];
                if !body.trim().is_empty() {
                    out.push(RawSection {
                        title: cur_title.clone(),
                        body,
                        offset: cur_start,
                        len: line_start - cur_start,
                    });
                }
                cur_title = trimmed.to_string();
                cur_start = i + 1; // skip newline
            }
            line_start = i + 1;
        }
        i += 1;
    }

    if cur_start < len {
        let body = &text[cur_start..];
        if !body.trim().is_empty() {
            out.push(RawSection {
                title: cur_title,
                body,
                offset: cur_start,
                len: len - cur_start,
            });
        }
    }

    if out.is_empty() {
        out.push(RawSection {
            title: String::new(),
            body: text,
            offset: 0,
            len,
        });
    }
    out
}

struct PageChunk<'a> {
    text: &'a str,
    offset: usize,
    len: usize,
}

fn paginate<'a>(body: &'a str, base_offset: usize) -> Vec<PageChunk<'a>> {
    let mut pages = Vec::new();
    let bytes = body.as_bytes();
    let total = bytes.len();
    let mut start = 0;
    while start < total {
        let mut end = (start + PAGE_BYTES).min(total);
        // Snap to nearest paragraph boundary backwards if possible.
        if end < total {
            if let Some(rel) = body[start..end].rfind("\n\n") {
                let candidate = start + rel + 2;
                if candidate > start + PAGE_BYTES / 2 {
                    end = candidate;
                }
            } else if let Some(rel) = body[start..end].rfind(' ') {
                let candidate = start + rel + 1;
                if candidate > start + PAGE_BYTES / 2 {
                    end = candidate;
                }
            }
        }
        // Don't break in the middle of a UTF-8 codepoint.
        while end < total && !body.is_char_boundary(end) {
            end += 1;
        }
        pages.push(PageChunk {
            text: &body[start..end],
            offset: base_offset + start,
            len: end - start,
        });
        start = end;
    }
    pages
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn paginate_short_text_yields_one_page() {
        let pages = paginate("Hello world.", 0);
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].text, "Hello world.");
    }

    #[test]
    fn paginate_long_text_splits_into_multiple_pages() {
        let s = "abc ".repeat(800); // 3200 bytes
        let pages = paginate(&s, 0);
        assert!(pages.len() >= 2, "got {} pages", pages.len());
        // All chunks together must equal the original.
        let joined: String = pages.iter().map(|p| p.text).collect();
        assert_eq!(joined, s);
    }

    #[test]
    fn paginate_preserves_offsets() {
        let s = "x".repeat(5000);
        let pages = paginate(&s, 100);
        assert_eq!(pages[0].offset, 100);
        let mut running = 100;
        for p in &pages {
            assert_eq!(p.offset, running);
            running += p.len;
        }
    }

    #[test]
    fn paginate_does_not_break_utf8_boundaries() {
        // Many multi-byte codepoints around the chunk boundary.
        let s = "日本語のテキスト ".repeat(400);
        let pages = paginate(&s, 0);
        for p in &pages {
            // If this would fail, indexing into p.text would have panicked above.
            // We additionally re-validate that each chunk is valid UTF-8.
            assert!(std::str::from_utf8(p.text.as_bytes()).is_ok());
        }
    }

    #[test]
    fn split_into_sections_detects_uppercase_headings() {
        let s = "INTRODUCTION\n\nFirst body line.\n\nCHAPTER ONE\n\nSecond body line.\n";
        let sections = split_into_sections(s);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "INTRODUCTION");
        assert_eq!(sections[1].title, "CHAPTER ONE");
    }

    #[test]
    fn split_into_sections_fallback_single_section() {
        let s = "just some plain text with no headings at all.";
        let sections = split_into_sections(s);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "");
    }

    #[test]
    fn import_txt_creates_book_with_pages() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let tmp = std::env::temp_dir().join(format!("demo-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, "CHAPTER ONE\n\nThis is page text. ".repeat(120)).unwrap();

        let book_id = import_txt_at_path(&conn, &tmp).unwrap();
        let page_count: i64 = conn
            .query_row("SELECT page_count FROM books WHERE id = ?1", [&book_id], |r| r.get(0))
            .unwrap();
        assert!(page_count >= 1);

        let actual_pages: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages WHERE book_id = ?1", [&book_id], |r| r.get(0))
            .unwrap();
        assert_eq!(actual_pages, page_count);

        std::fs::remove_file(&tmp).ok();
    }
}
