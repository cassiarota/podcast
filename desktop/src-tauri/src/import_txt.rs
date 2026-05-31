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

/// Heuristic chapter / section heading detection.
///
/// Originally only handled ALL-CAPS English (the dumb `no_lowercase` check),
/// which falsely flagged every short Chinese line as a heading. We now
/// recognize:
///   - Chinese chapter markers (`第N章 / 第N节 / 第N回 / 第N卷 / 第N篇`)
///   - Common Chinese single-token sections (`序章`, `正文卷`, `楔子`, ...)
///   - English chapter markers (`Chapter N`, `Part N`, `PROLOGUE`, ...)
///   - ALL-CAPS English headings with at least two ASCII letters
fn is_heading_line(trimmed: &str) -> bool {
    if trimmed.is_empty() || trimmed.len() > 80 {
        return false;
    }
    // Chinese chapter markers — "第N章" / "第N节" / "第N回" / "第N卷" / "第N篇"
    if trimmed.starts_with('第') {
        for ch in ['章', '节', '回', '卷', '篇'] {
            if trimmed.contains(ch) {
                return true;
            }
        }
    }
    // Common Chinese standalone heading tokens.
    const CHINESE_HEADINGS: &[&str] = &[
        "序章", "序言", "序", "楔子", "尾声", "番外", "终章", "终曲",
        "正文卷", "终结", "前言", "后记", "致谢",
    ];
    if CHINESE_HEADINGS.iter().any(|h| trimmed == *h) {
        return true;
    }
    // English chapter / part markers (case-insensitive).
    let lower = trimmed.to_ascii_lowercase();
    for prefix in ["chapter ", "part ", "book ", "section "] {
        if lower.starts_with(prefix) {
            return true;
        }
    }
    for token in ["prologue", "epilogue", "introduction", "preface", "foreword"] {
        if lower == token {
            return true;
        }
    }
    // ALL-CAPS English heading — at least two ASCII letters, no lowercase
    // ASCII letters anywhere.
    let ascii_letters: Vec<char> = trimmed.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    if ascii_letters.len() >= 2 && ascii_letters.iter().all(|c| c.is_ascii_uppercase()) {
        return true;
    }
    false
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
            let is_heading = is_heading_line(trimmed);

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
        // CRITICAL: snap `end` backwards to the nearest UTF-8 char boundary
        // BEFORE slicing, otherwise `body[start..end]` panics on CJK text
        // (e.g. PAGE_BYTES might land in the middle of a 3-byte 中文 char).
        while end > start && end < total && !body.is_char_boundary(end) {
            end -= 1;
        }
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
        // Belt-and-suspenders: forward-snap in case the candidate above
        // landed on a non-boundary (shouldn't happen, but cheap to verify).
        while end < total && !body.is_char_boundary(end) {
            end += 1;
        }
        // If for any reason we couldn't advance, force progress by one char.
        if end <= start {
            end = start + 1;
            while end < total && !body.is_char_boundary(end) {
                end += 1;
            }
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
    fn paginate_handles_cjk_at_page_boundary_without_panic() {
        // Regression for the crash hit on 道诡异仙.txt: PAGE_BYTES=1800 landed
        // inside a 3-byte 中文 codepoint and `body[start..end]` panicked.
        //
        // Build a body where the byte at PAGE_BYTES sits in the middle of a
        // multi-byte char and there's no \n\n or space in the second half
        // of the window — both refinement branches must be skipped cleanly.
        let s: String = std::iter::repeat('不').take(1000).collect(); // 3000 bytes, no whitespace
        let pages = paginate(&s, 0);
        // Must not panic; chunks must round-trip cleanly through UTF-8.
        let mut joined = String::new();
        for p in &pages {
            assert!(std::str::from_utf8(p.text.as_bytes()).is_ok());
            joined.push_str(p.text);
        }
        assert_eq!(joined, s, "paginate must not drop any source bytes");
    }

    #[test]
    fn paginate_handles_real_chinese_novel_passage() {
        // The exact opening paragraph of 道诡异仙 that triggered the original
        // panic at byte 1800 of '不'.
        let mut s = String::new();
        // Repeat enough Chinese text to easily exceed PAGE_BYTES.
        for _ in 0..50 {
            s.push_str("李火旺举起手中的捣药杆，百无聊赖的一下一下砸在捣药罐里，把里面夹杂着淤泥的流光青石慢慢碾磨成粉末。虽然这溶洞潮湿寒冷，但是他身上也只穿着一件粗糙布衣。但是他却满脸不在乎，似乎并没有把这一切放在眼里。");
        }
        let pages = paginate(&s, 0);
        assert!(pages.len() >= 2);
        let joined: String = pages.iter().map(|p| p.text).collect();
        assert_eq!(joined, s);
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
    fn split_into_sections_detects_chinese_chapter_markers() {
        let s = "第1章 师傅\n\n李火旺举起手中的捣药杆，砸在罐里。\n\n第2章 苦难\n\n他继续干活。\n";
        let sections = split_into_sections(s);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].title, "第1章 师傅");
        assert_eq!(sections[1].title, "第2章 苦难");
    }

    #[test]
    fn split_into_sections_does_not_falsely_flag_short_chinese_dialogue() {
        // Short Chinese lines (dialogue, narrative) must NOT be treated as
        // headings just because they have no ASCII lowercase letters.
        let s = "第1章 师傅\n\n“啊！”一声女人的惊恐尖叫。\n\n他无视嘈杂，继续干活。\n\n“俺就弄一下。”\n";
        let sections = split_into_sections(s);
        assert_eq!(sections.len(), 1, "got {} sections", sections.len());
        assert_eq!(sections[0].title, "第1章 师傅");
    }

    #[test]
    fn split_into_sections_handles_dashes_and_punctuation() {
        // Pure-punctuation lines like "------" must not be flagged.
        let s = "------------\n\nbody line\n\n====\n\nanother body\n";
        let sections = split_into_sections(s);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "");
    }

    #[test]
    fn split_into_sections_recognizes_common_chinese_sections() {
        let s = "序章\n\n开头介绍。\n\n第1章 开始\n\n正文。\n\n尾声\n\n结束语。\n";
        let sections = split_into_sections(s);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[0].title, "序章");
        assert_eq!(sections[1].title, "第1章 开始");
        assert_eq!(sections[2].title, "尾声");
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
