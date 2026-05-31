# Android — Phase 2 (Not Yet Implemented)

Per `docs/cloud-agent-handoff.md` and `docs/reader-app-plan.md`, Android is Phase 2. **Do not start Android first.** No code lives here yet; this directory exists only to reserve the structure and codify the plan.

## Target stack

- Kotlin + Jetpack Compose for the UI.
- ONNX Runtime Mobile (int8 quantized) for Kokoro TTS, **not** the desktop Python sidecar.
- SQLite via Room or AndroidX SQLite, mirroring the schema in `desktop/src-tauri/src/db.rs`.
- Bundled Kokoro assets from `../models/Kokoro-82M/`. The float model is too large for mobile; the Phase 2 deliverable converts it to a quantized ONNX export.

## What to preserve from the desktop work

- The SQLite schema (books / sections / pages / reading_positions / settings / tts_jobs / audio_chunks).
- The cache-key formula: `sha256(text_hash | engine | voice | language | speed)`.
- The lazy-load contract: no TTS model loaded at app launch — only on first generate/play request.
- The platform-agnostic UX rules: bookshelf-first, tap regions, auto-hiding controls, progress %, 10 background presets including eye-protect green.

## What changes on Android

- No Python sidecar — the engine runs in-process via ONNX Runtime Mobile.
- No filesystem dialog — use the Storage Access Framework for TXT/EPUB import.
- Page tap regions must respect Material insets and gesture navigation.

## When to start

Begin Phase 2 only after the desktop reader (M1–M2), TTS infrastructure (M3), Kokoro engine (M4), and Kokoro-on-macOS verification are stable. See the verification checklist in `../macos/README.md`.
