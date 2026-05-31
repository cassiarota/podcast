use std::path::Path;

use anyhow::{anyhow, Result};
use epub::doc::EpubDoc;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::now_secs;

const PAGE_BYTES: usize = 1800;

pub fn import_epub_at_path(conn: &Connection, path: &Path) -> Result<String> {
    let mut doc = EpubDoc::new(path).map_err(|e| anyhow!("epub open failed: {e}"))?;

    let title: String = doc
        .mdata("title")
        .map(|m| m.value.clone())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string()
        });
    let author: Option<String> = doc.mdata("creator").map(|m| m.value.clone());

    // Gather spine into (chapter_title, plain_text) pairs.
    let toc_titles: std::collections::HashMap<String, String> = doc
        .toc
        .iter()
        .map(|n| (n.content.to_string_lossy().to_string(), n.label.clone()))
        .collect();

    let spine_len = doc.spine.len();
    let mut chapters: Vec<(String, String)> = Vec::with_capacity(spine_len);
    for i in 0..spine_len {
        let _ = doc.set_current_chapter(i);
        let id = doc.get_current_id().unwrap_or_default();
        let path = doc.get_current_path().unwrap_or_default();
        let path_key = path.to_string_lossy().to_string();
        let chapter_title = toc_titles
            .get(&path_key)
            .cloned()
            .unwrap_or_else(|| id.clone());

        if let Some((bytes, _mime)) = doc.get_current() {
            let html = String::from_utf8_lossy(&bytes);
            let plain = html_to_text(&html);
            if !plain.trim().is_empty() {
                chapters.push((chapter_title, plain));
            }
        }
    }

    if chapters.is_empty() {
        return Err(anyhow!("epub had no readable chapters"));
    }

    let book_id = Uuid::new_v4().to_string();
    let full_text: String = chapters.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("\n\n");
    let source_hash = hex::encode(Sha256::digest(full_text.as_bytes()));
    let now = now_secs();

    conn.execute(
        "INSERT INTO books (id, title, author, source_format, source_path, source_hash, page_count, created_at)
         VALUES (?1, ?2, ?3, 'epub', ?4, ?5, 0, ?6)",
        params![
            book_id,
            title,
            author,
            path.to_string_lossy().to_string(),
            source_hash,
            now
        ],
    )?;

    let mut page_index: i64 = 0;
    let mut running_offset: usize = 0;
    for (ord, (chapter_title, body)) in chapters.into_iter().enumerate() {
        let section_id = Uuid::new_v4().to_string();
        let body_len = body.len();
        conn.execute(
            "INSERT INTO sections (id, book_id, title, ord, source_offset, source_len) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![section_id, book_id, chapter_title, ord as i64, running_offset as i64, body_len as i64],
        )?;

        let mut start = 0usize;
        while start < body_len {
            let mut end = (start + PAGE_BYTES).min(body_len);
            if end < body_len {
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
            while end < body_len && !body.is_char_boundary(end) {
                end += 1;
            }
            let chunk = &body[start..end];
            let page_id = Uuid::new_v4().to_string();
            let text_hash = hex::encode(Sha256::digest(chunk.as_bytes()));
            conn.execute(
                "INSERT INTO pages (id, book_id, section_id, page_index, text_hash, content, source_offset, source_len)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    page_id,
                    book_id,
                    section_id,
                    page_index,
                    text_hash,
                    chunk,
                    (running_offset + start) as i64,
                    (end - start) as i64
                ],
            )?;
            page_index += 1;
            start = end;
        }
        running_offset += body_len;
    }

    conn.execute(
        "UPDATE books SET page_count = ?1 WHERE id = ?2",
        params![page_index, book_id],
    )?;

    Ok(book_id)
}

/// Minimal HTML → text extractor. Strips tags + decodes a handful of entities.
fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag_buf = String::new();
    let mut skip_block: Option<&'static str> = None;
    for ch in html.chars() {
        if let Some(end_tag) = skip_block {
            // Wait until we close the skipped tag.
            if ch == '<' {
                in_tag = true;
                tag_buf.clear();
            } else if in_tag {
                if ch == '>' {
                    if tag_buf.eq_ignore_ascii_case(end_tag) {
                        skip_block = None;
                    }
                    in_tag = false;
                    tag_buf.clear();
                } else {
                    tag_buf.push(ch);
                }
            }
            continue;
        }
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
        } else if ch == '>' {
            in_tag = false;
            let lower = tag_buf.to_ascii_lowercase();
            let name = lower
                .trim_start_matches('/')
                .split_whitespace()
                .next()
                .unwrap_or("");
            match name {
                "script" => skip_block = Some("/script"),
                "style" => skip_block = Some("/style"),
                "br" | "/p" | "/div" | "/h1" | "/h2" | "/h3" | "/h4" | "/li" => {
                    out.push('\n');
                }
                "p" | "div" | "h1" | "h2" | "h3" | "h4" => {
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                }
                _ => {}
            }
            tag_buf.clear();
        } else if in_tag {
            tag_buf.push(ch);
        } else {
            out.push(ch);
        }
    }
    // Decode common entities.
    out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    // Collapse runs of blank lines to at most two newlines.
    let mut collapsed = String::with_capacity(out.len());
    let mut newline_run = 0;
    for ch in out.chars() {
        if ch == '\n' {
            newline_run += 1;
            if newline_run <= 2 {
                collapsed.push(ch);
            }
        } else {
            newline_run = 0;
            collapsed.push(ch);
        }
    }
    collapsed.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_to_text_strips_tags() {
        let html = "<p>Hello <b>world</b>!</p>";
        let plain = html_to_text(html);
        assert_eq!(plain, "Hello world!");
    }

    #[test]
    fn html_to_text_removes_script_and_style_blocks() {
        let html = "<p>Before</p><script>alert('x')</script><style>p{color:red}</style><p>After</p>";
        let plain = html_to_text(html);
        assert!(!plain.contains("alert"));
        assert!(!plain.contains("color:red"));
        assert!(plain.contains("Before"));
        assert!(plain.contains("After"));
    }

    #[test]
    fn html_to_text_decodes_common_entities() {
        let html = "<p>Tom&nbsp;&amp;&nbsp;Jerry &lt;3 &quot;tag&quot;</p>";
        let plain = html_to_text(html);
        assert!(plain.contains("Tom & Jerry"));
        assert!(plain.contains("<3"));
        assert!(plain.contains("\"tag\""));
    }

    #[test]
    fn html_to_text_collapses_blank_lines() {
        let html = "<p>One</p><p></p><p></p><p></p><p>Two</p>";
        let plain = html_to_text(html);
        // At most two consecutive newlines.
        assert!(!plain.contains("\n\n\n"));
        assert!(plain.contains("One"));
        assert!(plain.contains("Two"));
    }
}
