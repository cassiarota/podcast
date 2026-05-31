#!/usr/bin/env python3.12
"""End-to-end demo: import demo.txt and synthesize audio for it.

What this script does:
1. Initializes an empty SQLite library (using the same migration SQL as the Rust side).
2. Imports `demo.txt` via the same section-split + paginate logic the Rust importer uses.
3. Spins up the stub TTS engine in-process (no fastapi / no http).
4. Generates a WAV per page, writes it to `demo_runtime/audio_cache/`, and
   indexes each chunk in SQLite the same way the production code does.
5. Prints a summary.

Why a Python harness and not `pnpm tauri dev`:
- The Tauri dev server needs a webview and would block waiting for the user.
- This script exercises the *same business logic* end to end: import →
  paginate → cache-key derivation → engine synth → WAV on disk → SQLite row.
- It produces a real WAV you can `afplay demo_runtime/audio_cache/*.wav`.
"""

from __future__ import annotations

import hashlib
import sqlite3
import sys
import time
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SIDECAR = REPO / "desktop" / "sidecar"
sys.path.insert(0, str(SIDECAR))

from engine_stub import StubEngine  # noqa: E402

PAGE_BYTES = 1800
RUNTIME = REPO / "demo_runtime"
AUDIO_DIR = RUNTIME / "audio_cache"
DB_PATH = RUNTIME / "library.db"


# ---- SQLite migrations (kept in lock-step with desktop/src-tauri/src/db.rs) ----

MIGRATIONS = """
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT,
    source_format TEXT NOT NULL, source_path TEXT, source_hash TEXT,
    page_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
    ord INTEGER NOT NULL, source_offset INTEGER NOT NULL DEFAULT 0,
    source_len INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, section_id TEXT NOT NULL,
    page_index INTEGER NOT NULL, text_hash TEXT NOT NULL, content TEXT NOT NULL,
    source_offset INTEGER NOT NULL DEFAULT 0, source_len INTEGER NOT NULL DEFAULT 0,
    UNIQUE(book_id, page_index)
);
CREATE TABLE IF NOT EXISTS reading_positions (
    book_id TEXT PRIMARY KEY, section_id TEXT NOT NULL, page_index INTEGER NOT NULL,
    source_offset INTEGER NOT NULL DEFAULT 0, percent REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audio_chunks (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, page_id TEXT, section_id TEXT,
    cache_key TEXT NOT NULL UNIQUE, path TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0, engine TEXT NOT NULL,
    voice_preset TEXT NOT NULL, text_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
"""


def is_heading_line(line: str) -> bool:
    """Mirror of desktop/src-tauri/src/import_txt.rs::is_heading_line."""
    trimmed = line.strip()
    if not trimmed or len(trimmed.encode("utf-8")) > 80:
        return False
    if trimmed.startswith("第") and any(ch in trimmed for ch in "章节回卷篇"):
        return True
    if trimmed in {
        "序章", "序言", "序", "楔子", "尾声", "番外", "终章", "终曲",
        "正文卷", "终结", "前言", "后记", "致谢",
    }:
        return True
    lower = trimmed.lower()
    if any(lower.startswith(p) for p in ("chapter ", "part ", "book ", "section ")):
        return True
    if lower in {"prologue", "epilogue", "introduction", "preface", "foreword"}:
        return True
    ascii_letters = [c for c in trimmed if c.isascii() and c.isalpha()]
    if len(ascii_letters) >= 2 and all(c.isupper() for c in ascii_letters):
        return True
    return False


def split_into_sections(text: str) -> list[tuple[str, str, int, int]]:
    """Same heuristic as src/import_txt.rs::split_into_sections."""
    parts: list[tuple[str, int, int]] = []  # (title, start, end) by byte offset
    byte_cursor = 0
    pending_start = 0
    pending_title = ""
    for line in text.split("\n"):
        line_bytes = line.encode("utf-8")
        if is_heading_line(line) and byte_cursor > pending_start:
            parts.append((pending_title, pending_start, byte_cursor))
            pending_title = line.strip()
            pending_start = byte_cursor + len(line_bytes) + 1
        byte_cursor += len(line_bytes) + 1  # +1 for the newline
    parts.append((pending_title, pending_start, len(text.encode("utf-8"))))
    parts = [p for p in parts if text.encode("utf-8")[p[1] : p[2]].strip()]
    if not parts:
        parts = [("", 0, len(text.encode("utf-8")))]
    encoded = text.encode("utf-8")
    return [(title, encoded[s:e].decode("utf-8"), s, e - s) for title, s, e in parts]


def paginate(body: str, base_offset: int) -> list[tuple[str, int, int]]:
    """Same heuristic as src/import_txt.rs::paginate."""
    pages: list[tuple[str, int, int]] = []
    body_bytes = body.encode("utf-8")
    total = len(body_bytes)
    start = 0
    while start < total:
        end = min(start + PAGE_BYTES, total)
        if end < total:
            chunk = body_bytes[start:end]
            split_at = chunk.rfind(b"\n\n")
            if split_at != -1 and split_at > PAGE_BYTES // 2:
                end = start + split_at + 2
            else:
                space_at = chunk.rfind(b" ")
                if space_at != -1 and space_at > PAGE_BYTES // 2:
                    end = start + space_at + 1
        # Don't cut in the middle of a UTF-8 codepoint.
        while end < total and (body_bytes[end] & 0xC0) == 0x80:
            end += 1
        chunk_text = body_bytes[start:end].decode("utf-8", errors="ignore")
        pages.append((chunk_text, base_offset + start, end - start))
        start = end
    return pages


def cache_key(text_hash: str, engine: str, voice: str, lang: str, speed: float) -> str:
    raw = f"{text_hash}|{engine}|{voice}|{lang}|{speed:.2f}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="End-to-end import + TTS demo")
    parser.add_argument("--book", type=Path, default=REPO / "demo.txt",
                        help="Path to the TXT file to import. Default: ./demo.txt")
    parser.add_argument("--max-pages", type=int, default=0,
                        help="If >0, only synthesize the first N pages (useful for big books).")
    parser.add_argument("--engine", default="stub", choices=["stub"],
                        help="Engine to use. Only stub is supported inside this script — "
                             "for real Kokoro/Qwen, launch desktop/sidecar/main.py.")
    parser.add_argument("--voice", default="default")
    parser.add_argument("--language", default="en")
    args = parser.parse_args()

    print(f"[demo] Repo root: {REPO}")
    demo_path = args.book.expanduser().resolve()
    if not demo_path.exists():
        print(f"[demo] ERROR: {demo_path} missing")
        return 1

    RUNTIME.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()  # fresh demo every run

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(MIGRATIONS)

    text = demo_path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    source_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    book_id = str(uuid.uuid4())
    now = int(time.time())
    title = demo_path.stem or "Imported"
    conn.execute(
        "INSERT INTO books (id, title, author, source_format, source_path, source_hash, page_count, created_at) VALUES (?, ?, NULL, 'txt', ?, ?, 0, ?)",
        (book_id, title, str(demo_path), source_hash, now),
    )

    sections = split_into_sections(text)
    print(f"[demo] Imported book has {len(sections)} sections")

    page_records: list[tuple[str, str]] = []
    page_index = 0
    for ord_, (title, body, sec_offset, sec_len) in enumerate(sections):
        section_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sections (id, book_id, title, ord, source_offset, source_len) VALUES (?, ?, ?, ?, ?, ?)",
            (section_id, book_id, title, ord_, sec_offset, sec_len),
        )
        for chunk_text, off, length in paginate(body, sec_offset):
            page_id = str(uuid.uuid4())
            text_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
            conn.execute(
                "INSERT INTO pages (id, book_id, section_id, page_index, text_hash, content, source_offset, source_len) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (page_id, book_id, section_id, page_index, text_hash, chunk_text, off, length),
            )
            page_records.append((page_id, chunk_text))
            page_index += 1

    conn.execute("UPDATE books SET page_count = ? WHERE id = ?", (page_index, book_id))
    conn.commit()
    print(f"[demo] Paginated into {page_index} pages")

    engine = StubEngine()
    voice = args.voice
    language = args.language
    pages_to_render = page_records
    if args.max_pages and args.max_pages < len(page_records):
        pages_to_render = page_records[: args.max_pages]
        print(f"[demo] --max-pages={args.max_pages} (of {len(page_records)} total)")
    print(f"[demo] Synthesizing {len(pages_to_render)} pages with engine={engine.name} voice={voice} language={language}")

    total_duration_ms = 0
    for i, (page_id, page_text) in enumerate(pages_to_render):
        text_hash = hashlib.sha256(page_text.encode("utf-8")).hexdigest()
        key = cache_key(text_hash, engine.name, voice, language, 1.0)
        wav_path = AUDIO_DIR / f"{key}.wav"
        duration_ms = engine.synthesize(page_text, str(wav_path), voice=voice)
        total_duration_ms += duration_ms
        conn.execute(
            "INSERT OR REPLACE INTO audio_chunks (id, book_id, page_id, section_id, cache_key, path, duration_ms, engine, voice_preset, text_hash, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()), book_id, page_id, key, str(wav_path),
                duration_ms, engine.name, voice, text_hash, int(time.time()),
            ),
        )
        size_kb = wav_path.stat().st_size / 1024
        # Only print every 25th page when there are many, to keep output sane.
        if len(pages_to_render) <= 30 or i < 5 or i % 25 == 0 or i == len(pages_to_render) - 1:
            print(f"[demo]   page {i+1}/{len(pages_to_render)}: {duration_ms} ms ({size_kb:.1f} KB) -> {wav_path.name[:24]}…")
    conn.commit()

    # Verify the cache: replay the first page WITHOUT regenerating.
    first_page_id, first_text = pages_to_render[0]
    first_hash = hashlib.sha256(first_text.encode("utf-8")).hexdigest()
    first_key = cache_key(first_hash, engine.name, voice, language, 1.0)
    cur = conn.execute("SELECT path, duration_ms FROM audio_chunks WHERE cache_key = ?", (first_key,))
    row = cur.fetchone()
    assert row is not None, "cache lookup failed"
    cached_path, cached_dur = row
    assert Path(cached_path).exists(), f"cached wav missing: {cached_path}"
    print(f"[demo] Cache hit verified: {cached_path} ({cached_dur} ms)")

    total_size = sum(p.stat().st_size for p in AUDIO_DIR.glob("*.wav"))
    print(
        f"\n[demo] DONE — {len(pages_to_render)} pages synthesized out of "
        f"{page_index} total, {total_duration_ms / 1000:.1f}s total audio, "
        f"{total_size / 1024:.1f} KB on disk"
    )
    print(f"[demo] WAVs:  {AUDIO_DIR}")
    print(f"[demo] DB:    {DB_PATH}")
    print(f"[demo] Play:  afplay {next(AUDIO_DIR.glob('*.wav'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
