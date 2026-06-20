# Storage Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the app database and generated audio cache to configurable locations, defaulting to `D:\document\geektime-books\library.db` and `D:\document\geektime-books\audio`.

**Architecture:** Add a small bootstrap storage config outside the main DB so the app can find the DB before opening it. Runtime TTS, the Qwen sidecar, and the Geektime precache command all resolve paths through the same storage helper, while the settings UI exposes the two directories.

**Tech Stack:** Rust/Tauri, SQLite, React/TypeScript, PowerShell migration.

---

### Task 1: Storage Path Helper

**Files:**
- Create: `desktop/src-tauri/src/storage.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/src/sidecar.rs`
- Modify: `desktop/src-tauri/src/bin/precache_geektime.rs`

- [ ] Add `StorageSettings` with defaults:

```rust
data_dir = "D:\\document\\geektime-books"
audio_dir = "D:\\document\\geektime-books\\audio"
db_path = data_dir.join("library.db")
```

- [ ] Persist the bootstrap config to `%APPDATA%\com.podcast.reader\storage.json`.

- [ ] Use the helper before opening SQLite and before starting the sidecar.

### Task 2: Settings UI

**Files:**
- Modify: `desktop/src-tauri/src/reader.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/lib/api.ts`
- Modify: `desktop/src/views/Settings.tsx`
- Modify: `desktop/src/lib/i18n.ts`

- [ ] Add commands `get_storage_settings` and `save_storage_settings`.
- [ ] Add two storage rows: database directory and audio cache directory.
- [ ] Use directory picker buttons and show the selected paths.

### Task 3: Migration

**Files:**
- Modify: `desktop/src-tauri/src/storage.rs`
- Run: PowerShell migration commands

- [ ] Copy current `%APPDATA%\com.podcast.reader\library.db*` to `D:\document\geektime-books`.
- [ ] Move or copy existing WAV files to `D:\document\geektime-books\audio`.
- [ ] Update `audio_chunks.path` and `audio_sentences.path` to the new audio directory.
- [ ] Save `storage.json` with the new paths.

### Task 4: Verification

**Files:**
- Test: Rust and frontend type checks

- [ ] Run `cargo check --bin precache_geektime`.
- [ ] Run `cargo test tts -- --nocapture`.
- [ ] Run `pnpm build` or the project equivalent if available.
- [ ] Run precache `status` to confirm it reads the D-drive DB.
