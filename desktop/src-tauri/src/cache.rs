use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub fn cache_key(text_hash: &str, engine: &str, voice: &str, lang: &str, speed: f32) -> String {
    let raw = format!("{text_hash}|{engine}|{voice}|{lang}|{speed:.2}");
    hex::encode(Sha256::digest(raw.as_bytes()))
}

pub fn cache_path(audio_dir: &Path, key: &str) -> PathBuf {
    audio_dir.join(format!("{key}.wav"))
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
}
