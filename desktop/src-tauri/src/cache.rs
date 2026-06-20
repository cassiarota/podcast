use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub fn cache_key(text_hash: &str, engine: &str, voice: &str, lang: &str, speed: f32) -> String {
    let raw = format!("{text_hash}|{engine}|{voice}|{lang}|{speed:.2}");
    hex::encode(Sha256::digest(raw.as_bytes()))
}

pub fn cache_path(audio_dir: &Path, key: &str) -> PathBuf {
    audio_dir.join(format!("{key}.wav"))
}

pub fn book_audio_folder_name(title: &str, source_path: Option<&str>, book_id: &str) -> String {
    // Extract the file stem ourselves rather than via `Path::file_stem`: book
    // source paths are Windows paths (books live on `D:\...`), but the desktop
    // app also runs on macOS, where `Path` doesn't treat `\` as a separator and
    // would fold the entire path into the folder name. Split on both separators
    // so the same source yields the same folder on every platform.
    let source_stem = source_path
        .map(|path| path.rsplit(['/', '\\']).next().unwrap_or(path))
        .map(|name| match name.rsplit_once('.') {
            Some((stem, _ext)) if !stem.is_empty() => stem,
            _ => name,
        })
        .map(str::trim)
        .filter(|stem| !stem.is_empty());
    let base = source_stem.unwrap_or_else(|| title.trim());
    let sanitized = sanitize_folder_component(base);
    let prefix = if sanitized.is_empty() {
        "book".to_string()
    } else {
        sanitized
    };
    let short_id: String = book_id.chars().take(8).collect();
    if short_id.is_empty() {
        prefix
    } else {
        format!("{prefix}__{short_id}")
    }
}

pub fn cache_path_for_book(audio_dir: &Path, book_folder: &str, key: &str) -> PathBuf {
    if book_folder.trim().is_empty() {
        cache_path(audio_dir, key)
    } else {
        audio_dir.join(book_folder).join(format!("{key}.wav"))
    }
}

fn sanitize_folder_component(raw: &str) -> String {
    let mut out = String::new();
    let mut previous_was_space = false;
    for ch in raw.chars() {
        let replacement = if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            '_'
        } else {
            ch
        };
        if replacement.is_whitespace() {
            if !previous_was_space {
                out.push(' ');
                previous_was_space = true;
            }
        } else {
            out.push(replacement);
            previous_was_space = false;
        }
        if out.len() >= 96 {
            break;
        }
    }
    out.trim_matches([' ', '.']).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_deterministic() {
        let a = cache_key("abc", "kokoro", "default", "en", 1.0);
        let b = cache_key("abc", "kokoro", "default", "en", 1.0);
        assert_eq!(a, b);
        assert_eq!(a.len(), 64); // sha256 hex
    }

    #[test]
    fn cache_key_changes_with_every_field() {
        let base = cache_key("h", "kokoro", "v1", "en", 1.0);
        assert_ne!(base, cache_key("h2", "kokoro", "v1", "en", 1.0));
        assert_ne!(base, cache_key("h", "qwen", "v1", "en", 1.0));
        assert_ne!(base, cache_key("h", "kokoro", "v2", "en", 1.0));
        assert_ne!(base, cache_key("h", "kokoro", "v1", "ja", 1.0));
        assert_ne!(base, cache_key("h", "kokoro", "v1", "en", 1.25));
    }

    #[test]
    fn cache_path_joins_with_wav_extension() {
        let p = cache_path(Path::new("/tmp/cache"), "abc123");
        assert_eq!(p, PathBuf::from("/tmp/cache/abc123.wav"));
    }

    #[test]
    fn book_audio_folder_is_safe_and_stable() {
        let folder = book_audio_folder_name(
            "ignored title",
            Some(r"D:\document\geektime-books\04-左耳听风.epub"),
            "12345678-aaaa",
        );
        assert_eq!(folder, "04-左耳听风__12345678");
        assert!(!folder.contains('\\'));
    }

    #[test]
    fn book_audio_folder_handles_unix_source_paths() {
        let folder = book_audio_folder_name(
            "ignored title",
            Some("/Users/me/books/My Book.txt"),
            "abcdef01-2222",
        );
        assert_eq!(folder, "My Book__abcdef01");
    }

    #[test]
    fn cache_path_for_book_nests_under_book_folder() {
        let p = cache_path_for_book(Path::new("/tmp/cache"), "book-a", "abc123");
        assert_eq!(p, PathBuf::from("/tmp/cache/book-a/abc123.wav"));
    }
}
