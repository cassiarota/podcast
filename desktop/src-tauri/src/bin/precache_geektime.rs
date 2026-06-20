use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use podcast_reader_lib::{cache, db, import_epub, reader, storage, tts};
use reqwest::StatusCode;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const PORT: u16 = 38219;
const ENGINE: &str = "qwen";
const VOICE: &str = "default";
const LANGUAGE: &str = "zh";
const SPEED: f32 = 1.0;
const DEFAULT_BATCH_SIZE: usize = 8;
const DEFAULT_BATCH_CHAR_LIMIT: usize = 900;

const TARGETS: &[&str] = &[
    "06-MySQL实战45讲.epub",
    "146-Redis核心技术与实战.epub",
    "04-左耳听风.epub",
    "10-如何设计一个秒杀系统.epub",
    "108-摄影入门课.epub",
    "03-从0开始学架构.epub",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Resume,
    Status,
    Verify,
}

#[derive(Debug, Deserialize)]
struct SynthResult {
    duration_ms: i64,
    cache_key: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct BatchSynthResult {
    items: Vec<SynthResult>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let (mode, library_dir) = parse_args();
    let storage_settings = storage::load_storage_settings()?;
    let audio_dir = storage_settings.audio_dir_path();
    std::fs::create_dir_all(&audio_dir)?;

    let db_path = storage_settings.db_path();
    let conn = db::open(&db_path)?;
    db::migrate(&conn)?;

    if mode == Mode::Status || mode == Mode::Verify {
        print_status(&conn, &library_dir, mode == Mode::Verify)?;
        return Ok(());
    }

    save_qwen_settings(&conn)?;

    let mut sidecar = ensure_sidecar(&audio_dir).await?;
    let limited_run = env_optional_usize("PRECACHE_MAX_NEW_SENTENCES").is_some();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()?;

    for file_name in TARGETS {
        let path = library_dir.join(file_name);
        if !path.exists() {
            return Err(anyhow!("missing target EPUB: {}", path.display()));
        }
        let book_id = import_or_reuse_book(&conn, &path)
            .with_context(|| format!("import {}", path.display()))?;
        let title: String = conn.query_row(
            "SELECT title FROM books WHERE id = ?1",
            params![book_id],
            |r| r.get(0),
        )?;
        let source_path: Option<String> = conn.query_row(
            "SELECT source_path FROM books WHERE id = ?1",
            params![book_id],
            |r| r.get(0),
        )?;
        let book_folder = cache::book_audio_folder_name(&title, source_path.as_deref(), &book_id);
        let sentences = load_book_sentences(&conn, &book_id)?;
        println!(
            "[book] {} | {} | audio_dir={} | pages/sentences = {}/{}",
            title,
            book_id,
            audio_dir.join(&book_folder).display(),
            page_count(&conn, &book_id)?,
            sentences.len()
        );
        precache_book(&conn, &client, &audio_dir, &book_folder, &mut sidecar, &book_id, &sentences).await?;
        if limited_run {
            stop_sidecar(&mut sidecar);
            println!("[done] limited precache run finished");
            return Ok(());
        }
        verify_book(&conn, &book_id)?;
    }

    stop_sidecar(&mut sidecar);
    println!("[done] all target books are imported and sentence audio is cached");
    Ok(())
}

fn parse_args() -> (Mode, PathBuf) {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mode = match args.first().map(|s| s.as_str()) {
        Some("resume") => {
            args.remove(0);
            Mode::Resume
        }
        Some("status") => {
            args.remove(0);
            Mode::Status
        }
        Some("verify") => {
            args.remove(0);
            Mode::Verify
        }
        _ => Mode::Resume,
    };
    let library_dir = args
        .first()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"D:\document\geektime-books"));
    (mode, library_dir)
}

fn save_qwen_settings(conn: &rusqlite::Connection) -> Result<()> {
    let settings = reader::TtsSettings {
        engine: ENGINE.to_string(),
        voice: VOICE.to_string(),
        language: LANGUAGE.to_string(),
        speed: SPEED as f64,
        preload: false,
        imports_backup_dir: None,
    };
    let json = serde_json::to_string(&settings)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('tts', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )?;
    Ok(())
}

async fn ensure_sidecar(audio_dir: &Path) -> Result<Option<Child>> {
    if healthz().await {
        println!("[sidecar] reusing existing sidecar on port {PORT}");
        return Ok(None);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let sidecar_dir = manifest_dir.join("../sidecar");
    let python = sidecar_dir.join(".venv/Scripts/python.exe");
    let main_py = sidecar_dir.join("main.py");
    if !python.exists() {
        return Err(anyhow!("sidecar python missing: {}", python.display()));
    }
    if !main_py.exists() {
        return Err(anyhow!("sidecar main.py missing: {}", main_py.display()));
    }

    println!("[sidecar] starting Qwen sidecar on port {PORT}");
    let mut cmd = Command::new(python);
    cmd.arg(main_py)
        .arg("--port")
        .arg(PORT.to_string())
        .arg("--audio-cache")
        .arg(audio_dir)
        .arg("--engine")
        .arg(ENGINE)
        .env("TTS_IDLE_TIMEOUT", "3600")
        .env("OMP_NUM_THREADS", "1")
        .env("OPENBLAS_NUM_THREADS", "1")
        .env("MKL_NUM_THREADS", "1")
        .env("NUMEXPR_NUM_THREADS", "1")
        .env("TOKENIZERS_PARALLELISM", "false")
        .env("PYTORCH_CUDA_ALLOC_CONF", "max_split_size_mb:512")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .stdin(Stdio::null());
    let child = cmd.spawn().context("spawn sidecar")?;

    for _ in 0..80 {
        if healthz().await {
            println!("[sidecar] ready");
            return Ok(Some(child));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(anyhow!("sidecar /healthz did not become ready"))
}

fn stop_sidecar(sidecar: &mut Option<Child>) {
    if let Some(mut child) = sidecar.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

async fn restart_sidecar(sidecar: &mut Option<Child>, audio_dir: &Path) -> Result<()> {
    eprintln!("[sidecar] restarting after failed synth request");
    stop_sidecar(sidecar);
    tokio::time::sleep(Duration::from_secs(3)).await;
    *sidecar = ensure_sidecar(audio_dir).await?;
    Ok(())
}

async fn healthz() -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build();
    let Ok(client) = client else { return false };
    matches!(
        client
            .get(format!("http://127.0.0.1:{PORT}/healthz"))
            .send()
            .await,
        Ok(resp) if resp.status().is_success()
    )
}

fn import_or_reuse_book(conn: &rusqlite::Connection, path: &Path) -> Result<String> {
    let source_path = path.to_string_lossy().to_string();
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM books WHERE source_path = ?1 ORDER BY created_at DESC LIMIT 1",
            params![source_path],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        println!("[import] reuse {}", path.display());
        return Ok(id);
    }
    println!("[import] {}", path.display());
    import_epub::import_epub_at_path(conn, path)
}

fn book_id_for_path(conn: &rusqlite::Connection, path: &Path) -> Result<Option<String>> {
    let source_path = path.to_string_lossy().to_string();
    conn.query_row(
        "SELECT id FROM books WHERE source_path = ?1 ORDER BY created_at DESC LIMIT 1",
        params![source_path],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(Into::into)
}

fn print_status(conn: &rusqlite::Connection, library_dir: &Path, require_complete: bool) -> Result<()> {
    let mut all_complete = true;
    println!("[status] target books");
    for file_name in TARGETS {
        let path = library_dir.join(file_name);
        if !path.exists() {
            all_complete = false;
            println!("[missing-epub] {}", path.display());
            continue;
        }
        let Some(book_id) = book_id_for_path(conn, &path)? else {
            all_complete = false;
            println!("[not-imported] {}", file_name);
            continue;
        };
        let title: String = conn.query_row(
            "SELECT title FROM books WHERE id = ?1",
            params![book_id],
            |r| r.get(0),
        )?;
        let total = load_book_sentences(conn, &book_id)?.len();
        let mapped: i64 = conn.query_row(
            "SELECT COUNT(*) FROM audio_sentences WHERE book_id = ?1 AND engine = ?2 AND voice_preset = ?3",
            params![book_id, ENGINE, VOICE],
            |r| r.get(0),
        )?;
        let existing = existing_audio_file_count(conn, &book_id)?;
        let complete = mapped as usize == total && existing == total;
        if !complete {
            all_complete = false;
        }
        println!(
            "[book-status] {} | {} | mapped={}/{} files={}/{} complete={}",
            title,
            book_id,
            mapped,
            total,
            existing,
            total,
            complete
        );
    }
    if require_complete && !all_complete {
        return Err(anyhow!("not all target books have complete sentence audio yet"));
    }
    if all_complete {
        println!("[status] all target books are complete");
    }
    Ok(())
}

fn existing_audio_file_count(conn: &rusqlite::Connection, book_id: &str) -> Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT path FROM audio_sentences WHERE book_id = ?1 AND engine = ?2 AND voice_preset = ?3",
    )?;
    let paths = stmt.query_map(params![book_id, ENGINE, VOICE], |r| r.get::<_, String>(0))?;
    let mut existing = 0usize;
    for path in paths {
        if Path::new(&path?).exists() {
            existing += 1;
        }
    }
    Ok(existing)
}

#[derive(Debug)]
struct SentenceRow {
    page_id: String,
    section_id: String,
    sentence_index: usize,
    text: String,
}

fn load_book_sentences(conn: &rusqlite::Connection, book_id: &str) -> Result<Vec<SentenceRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, section_id, content FROM pages WHERE book_id = ?1 ORDER BY page_index",
    )?;
    let pages = stmt.query_map(params![book_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in pages {
        let (page_id, section_id, content) = row?;
        for (sentence_index, text) in tts::split_sentences(&content).into_iter().enumerate() {
            out.push(SentenceRow {
                page_id: page_id.clone(),
                section_id: section_id.clone(),
                sentence_index,
                text,
            });
        }
    }
    Ok(out)
}

async fn precache_book(
    conn: &rusqlite::Connection,
    client: &reqwest::Client,
    audio_dir: &Path,
    book_folder: &str,
    sidecar: &mut Option<Child>,
    book_id: &str,
    sentences: &[SentenceRow],
) -> Result<()> {
    let mut done = existing_sentence_count(conn, book_id)?;
    let mut last_report = done;
    let total = sentences.len();
    let batch_size = env_usize("PRECACHE_BATCH_SIZE", DEFAULT_BATCH_SIZE).max(1);
    let batch_char_limit = env_usize("PRECACHE_BATCH_CHAR_LIMIT", DEFAULT_BATCH_CHAR_LIMIT).max(1);
    let max_new_sentences = env_optional_usize("PRECACHE_MAX_NEW_SENTENCES");
    println!("[config] batch_size={batch_size} batch_char_limit={batch_char_limit} max_new_sentences={}", max_new_sentences.map(|v| v.to_string()).unwrap_or_else(|| "unlimited".into()));
    let mut idx = 0usize;
    let mut generated_this_run = 0usize;
    while idx < sentences.len() {
        if max_new_sentences.is_some_and(|max| generated_this_run >= max) {
            println!("[limit] generated {generated_this_run} new sentence audio files; stopping early");
            break;
        }
        let sentence = &sentences[idx];
        let text_hash = hex::encode(Sha256::digest(sentence.text.as_bytes()));
        let key = cache::cache_key(&text_hash, ENGINE, VOICE, LANGUAGE, SPEED);
        if sentence_cached(conn, sentence, &text_hash, &key)? {
            idx += 1;
            continue;
        }

        let mut batch: Vec<(usize, String, String)> = Vec::new();
        let mut chars = 0usize;
        while idx < sentences.len() && batch.len() < batch_size {
            if max_new_sentences.is_some_and(|max| generated_this_run + batch.len() >= max) {
                break;
            }
            let candidate = &sentences[idx];
            let candidate_hash = hex::encode(Sha256::digest(candidate.text.as_bytes()));
            let candidate_key = cache::cache_key(&candidate_hash, ENGINE, VOICE, LANGUAGE, SPEED);
            if sentence_cached(conn, candidate, &candidate_hash, &candidate_key)? {
                idx += 1;
                continue;
            }
            let candidate_chars = candidate.text.chars().count();
            if !batch.is_empty() && chars + candidate_chars > batch_char_limit {
                break;
            }
            chars += candidate_chars;
            batch.push((idx, candidate_hash, candidate_key));
            idx += 1;
        }
        if batch.is_empty() {
            continue;
        }

        let texts_and_keys: Vec<(&str, &str)> = batch
            .iter()
            .map(|(i, _hash, key)| (sentences[*i].text.as_str(), key.as_str()))
            .collect();
        let bodies = synth_batch_adaptive(client, sidecar, audio_dir, book_folder, &texts_and_keys).await?;
        for ((sentence_idx, text_hash, key), body) in batch.iter().zip(bodies.iter()) {
            if &body.cache_key != key {
                return Err(anyhow!("batch cache key mismatch: got {}, expected {}", body.cache_key, key));
            }
            let sentence = &sentences[*sentence_idx];
            upsert_cache_rows(conn, book_id, sentence, text_hash, body)?;
            done += 1;
            generated_this_run += 1;
            let expected = cache::cache_path_for_book(audio_dir, book_folder, key);
            if !expected.exists() {
                return Err(anyhow!("sidecar reported success but WAV is missing: {}", expected.display()));
            }
        }
        if done.saturating_sub(last_report) >= 25 || done >= total {
            println!("[progress] {book_id} {done}/{total}");
            last_report = done;
        }
    }
    Ok(())
}

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(default)
}

fn env_optional_usize(key: &str) -> Option<usize> {
    std::env::var(key).ok().and_then(|v| v.parse::<usize>().ok())
}

fn sentence_cached(
    conn: &rusqlite::Connection,
    sentence: &SentenceRow,
    text_hash: &str,
    key: &str,
) -> Result<bool> {
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM audio_sentences
             WHERE page_id = ?1 AND sentence_index = ?2 AND engine = ?3 AND voice_preset = ?4 AND text_hash = ?5 AND cache_key = ?6",
            params![
                sentence.page_id,
                sentence.sentence_index as i64,
                ENGINE,
                VOICE,
                text_hash,
                key
            ],
            |r| r.get(0),
        )
        .optional()?;
    Ok(path
        .as_deref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false))
}

async fn synth_batch_adaptive(
    client: &reqwest::Client,
    sidecar: &mut Option<Child>,
    audio_dir: &Path,
    book_folder: &str,
    texts_and_keys: &[(&str, &str)],
) -> Result<Vec<SynthResult>> {
    let mut out: Vec<Option<SynthResult>> = (0..texts_and_keys.len()).map(|_| None).collect();
    let mut stack = vec![(0usize, texts_and_keys.len())];
    let mut restart_budget = 12usize;
    while let Some((start, end)) = stack.pop() {
        if start >= end {
            continue;
        }
        let slice = &texts_and_keys[start..end];
        match synth_batch_once(client, book_folder, slice).await {
            Ok(items) => {
                for (offset, item) in items.into_iter().enumerate() {
                    out[start + offset] = Some(item);
                }
            }
            Err(e) => {
                eprintln!(
                    "[batch] {} items failed ({}); splitting",
                    end - start,
                    e
                );
                if restart_budget > 0 {
                    restart_budget -= 1;
                    restart_sidecar(sidecar, audio_dir).await?;
                }
                if end - start > 1 {
                    let mid = start + (end - start) / 2;
                    stack.push((mid, end));
                    stack.push((start, mid));
                } else if restart_budget > 0 {
                    stack.push((start, end));
                } else {
                    return Err(anyhow!(
                        "single sentence still failed after sidecar restarts: {}",
                        e
                    ));
                }
            }
        }
    }
    out.into_iter()
        .enumerate()
        .map(|(i, item)| item.ok_or_else(|| anyhow!("missing batch result at index {i}")))
        .collect()
}

async fn synth_batch_once(
    client: &reqwest::Client,
    book_folder: &str,
    texts_and_keys: &[(&str, &str)],
) -> Result<Vec<SynthResult>> {
    let req = serde_json::json!({
        "items": texts_and_keys
            .iter()
            .map(|(text, key)| serde_json::json!({ "text": text, "cache_key": key }))
            .collect::<Vec<_>>(),
        "engine": ENGINE,
        "voice": VOICE,
        "cache_subdir": book_folder,
        "language": LANGUAGE,
        "speed": SPEED,
    });
    match client
        .post(format!("http://127.0.0.1:{PORT}/tts/batch"))
        .json(&req)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let body = resp.json::<BatchSynthResult>().await?;
            if body.items.len() != texts_and_keys.len() {
                return Err(anyhow!(
                    "batch result length mismatch: got {}, expected {}",
                    body.items.len(),
                    texts_and_keys.len()
                ));
            }
            Ok(body.items)
        }
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if status == StatusCode::SERVICE_UNAVAILABLE {
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            Err(anyhow!("{status}: {text}"))
        }
        Err(e) => Err(e.into()),
    }
}

fn upsert_cache_rows(
    conn: &rusqlite::Connection,
    book_id: &str,
    sentence: &SentenceRow,
    text_hash: &str,
    body: &SynthResult,
) -> Result<()> {
    let now = db::now_secs();
    conn.execute(
        "INSERT OR IGNORE INTO audio_chunks (id, book_id, page_id, section_id, sentence_index, cache_key, path, duration_ms, engine, voice_preset, text_hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            Uuid::new_v4().to_string(),
            book_id,
            sentence.page_id,
            sentence.section_id,
            sentence.sentence_index as i64,
            body.cache_key,
            body.path,
            body.duration_ms,
            ENGINE,
            VOICE,
            text_hash,
            now
        ],
    )?;
    conn.execute(
        "INSERT INTO audio_sentences (id, book_id, page_id, section_id, sentence_index, text, text_hash, cache_key, path, duration_ms, engine, voice_preset, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(book_id, page_id, sentence_index, engine, voice_preset, text_hash)
         DO UPDATE SET cache_key = excluded.cache_key, path = excluded.path, duration_ms = excluded.duration_ms, created_at = excluded.created_at",
        params![
            Uuid::new_v4().to_string(),
            book_id,
            sentence.page_id,
            sentence.section_id,
            sentence.sentence_index as i64,
            sentence.text,
            text_hash,
            body.cache_key,
            body.path,
            body.duration_ms,
            ENGINE,
            VOICE,
            now
        ],
    )?;
    Ok(())
}

fn existing_sentence_count(conn: &rusqlite::Connection, book_id: &str) -> Result<usize> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audio_sentences WHERE book_id = ?1 AND engine = ?2 AND voice_preset = ?3",
        params![book_id, ENGINE, VOICE],
        |r| r.get(0),
    )?;
    Ok(count.max(0) as usize)
}

fn page_count(conn: &rusqlite::Connection, book_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT page_count FROM books WHERE id = ?1",
        params![book_id],
        |r| r.get(0),
    )
    .map_err(Into::into)
}

fn verify_book(conn: &rusqlite::Connection, book_id: &str) -> Result<()> {
    let total = load_book_sentences(conn, book_id)?.len() as i64;
    let cached: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audio_sentences WHERE book_id = ?1 AND engine = ?2 AND voice_preset = ?3",
        params![book_id, ENGINE, VOICE],
        |r| r.get(0),
    )?;
    if cached != total {
        return Err(anyhow!("verification failed for {book_id}: cached {cached}, expected {total}"));
    }

    let mut stmt = conn.prepare(
        "SELECT path FROM audio_sentences WHERE book_id = ?1 AND engine = ?2 AND voice_preset = ?3",
    )?;
    let paths = stmt.query_map(params![book_id, ENGINE, VOICE], |r| r.get::<_, String>(0))?;
    let mut missing = 0usize;
    for path in paths {
        if !Path::new(&path?).exists() {
            missing += 1;
        }
    }
    if missing > 0 {
        return Err(anyhow!("verification failed for {book_id}: {missing} missing WAV files"));
    }
    println!("[verify] {book_id} cached sentence audio = {cached}/{total}");
    Ok(())
}
