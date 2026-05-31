# Reader App Implementation Plan

## Summary

Build a Tauri v2 native desktop reader app for Windows and macOS from one shared React/TypeScript UI codebase. The app starts light: no TTS model loads at launch. A lazy local Python TTS sidecar starts only when the user generates or plays audio, keeps the model warm briefly, then unloads after an idle timeout.

Windows uses external Qwen model folders under `D:\models` and requires CUDA. macOS uses bundled Kokoro from `models/Kokoro-82M`. Android is Phase 2 and should use a bundled Kokoro mobile runtime rather than the desktop Python sidecar.

## Product Requirements

- Import TXT and EPUB books.
- Main screen shows imported books on a realistic bookshelf-style visual.
- Each book appears as a cover/spine with its title.
- Bottom shelf includes an add/import button.
- Import flow offers an option to generate audio immediately.
- Reader mode opens when a book is selected.
- Reader page supports left/right tap regions for page turns.
- Center tap shows hidden controls.
- Bottom controls auto-hide after inactivity.
- Bottom-right shows reading progress percentage.
- Controls include:
  - Font size: small, medium, large.
  - Background color: 10 presets, including eye-protect green.
  - Brightness: dark to bright.
  - Content/table-of-contents button.
- TTS supports:
  - Offline generation for whole book.
  - Offline generation for selected section.
  - Realtime current-page generation and playback.
  - Progress percentage for offline generation.
  - Permanent audio cache shared by offline and realtime modes.

## Architecture

Use a Tauri v2 app with these layers:

- UI: React + TypeScript + Vite.
- Native shell: Rust/Tauri commands.
- Storage: SQLite in the app data directory.
- Assets: generated bookshelf art and bundled Kokoro resources.
- TTS: lazy Python service managed as a Tauri sidecar on desktop.
- Audio cache: WAV chunks stored in app data, indexed in SQLite.

The frontend must not directly access arbitrary local files. File import, cache reads, model readiness checks, and sidecar lifecycle should go through Tauri commands.

## Data Model

Use SQLite tables or equivalent migrations for:

- `books`: id, title, author, source format, imported path/hash, created time.
- `sections`: id, book id, title, order, source range.
- `pages`: id, book id, section id, page index, text hash, text content or content pointer.
- `reading_positions`: book id, section id, page index, percent, updated time.
- `tts_jobs`: id, book id, scope, status, progress, engine, voice preset, created time.
- `audio_chunks`: id, book id, page/section/chunk id, cache key, path, duration, engine, voice preset, text hash.
- `settings`: reader defaults and TTS defaults.

The exact schema can evolve during implementation, but cache keys must include source text hash, engine, model version/path, voice preset, language setting, and speed/style settings.

## Book Import And Pagination

TXT import:

- Read text as UTF-8 by default.
- Normalize line endings.
- Split into sections using headings when obvious, otherwise one section.
- Paginate by measured reader layout where possible, or by deterministic text chunks for v1.

EPUB import:

- Parse metadata title/author.
- Use EPUB spine order for reading order.
- Use the EPUB TOC when available.
- Store chapters as sections.
- Strip unsupported scripts/styles and keep readable text content.

Pagination must be stable enough that reading progress and audio chunk mapping survive restarts. If a setting change changes pagination, preserve progress by source text offset rather than only page number.

## Reader UX

Reader screen layout:

- Full reading surface.
- Left third turns to previous page.
- Right third turns to next page.
- Center third toggles controls.
- Bottom control bar overlays content and auto-hides.
- Reading progress percentage stays at bottom right.
- Content/TOC opens as a side panel or modal.

Settings:

- Font size presets map to fixed app typography values.
- Background presets include white, warm paper, dark, black, gray, sepia, low contrast, and eye-protect green.
- Brightness applies a visual dimming layer or theme adjustment without changing system brightness.

## Bookshelf UX

The bookshelf screen should feel like a real shelf, not a plain grid.

- Use a generated bitmap shelf background checked into the app assets.
- Render book covers/spines aligned to shelf rows.
- Show book title prominently on each book.
- Keep the add/import button at the bottom shelf area.
- Empty state should still show the shelf and invite import.

Do not build a marketing landing page. The first screen should be the usable library.

## TTS Behavior

No model should load on app launch.

When generation or realtime playback starts:

1. Tauri starts or wakes the Python TTS service.
2. The service checks engine readiness.
3. The selected model loads lazily.
4. The job is split into chunks.
5. Each chunk is generated to a WAV file.
6. SQLite is updated as chunks complete.
7. Progress events stream back to the UI.
8. The worker unloads after an idle timeout.

Offline generation:

- Scope can be whole book or selected section.
- Show queued/loading/generating/cached/failed/canceled/completed states.
- Progress is chunk-based.
- Completed chunks remain usable after cancellation or failure.

Realtime generation:

- Default scope is the current page.
- Generate and play the visible page.
- Prefetch the next page.
- Write generated chunks to the same permanent cache used by offline generation.
- If cached audio already exists, play from cache immediately.

Audio format:

- Use WAV chunks for v1 reliability.
- Add compression later only after playback and packaging are stable.

## Platform TTS Engines

Windows:

- Use Qwen through the `qwen-tts` Python package.
- Use external model paths:
  - `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice`
  - `D:\models\Qwen3-TTS-Tokenizer-12Hz`
- Require NVIDIA CUDA.
- Show a clear readiness error if CUDA or model paths are unavailable.
- Do not promise CPU fallback in v1.

macOS:

- Use Kokoro bundled under `models/Kokoro-82M`.
- Package Kokoro resources with the app.
- Keep the same cache, job, and playback interfaces as Windows.

Android Phase 2:

- Reuse library/reader UX concepts.
- Bundle Kokoro assets.
- Use an Android-appropriate runtime, likely ONNX/int8 or another mobile-compatible Kokoro pipeline.
- Do not use the desktop Python sidecar architecture.

## Public Interfaces

Frontend-to-Tauri commands:

- `import_book(path, generate_audio)`
- `list_books()`
- `open_book(book_id)`
- `save_reading_position(book_id, section_id, page_index, source_offset)`
- `get_reader_settings()`
- `save_reader_settings(settings)`
- `start_tts_job(book_id, scope, voice_preset)`
- `cancel_tts_job(job_id)`
- `play_cached_or_generate(book_id, page_id, voice_preset)`
- `get_tts_status()`

TTS service endpoints:

- `GET /healthz`
- `GET /ready`
- `POST /tts/jobs`
- `GET /tts/jobs/{id}`
- `GET /tts/jobs/{id}/events`
- `POST /tts/jobs/{id}/cancel`
- `POST /tts/realtime`

## Development Order

1. Scaffold Tauri v2 + React/TypeScript/Vite.
2. Add SQLite store and migrations.
3. Implement TXT import and basic bookshelf.
4. Implement reader pagination and reading position persistence.
5. Add reader controls and themes.
6. Add EPUB import.
7. Add generated bookshelf art.
8. Add audio cache schema and cache file management.
9. Add Python sidecar shell with health checks only.
10. Add Kokoro generation on macOS/dev-compatible path.
11. Add Qwen generation on Windows CUDA path.
12. Add offline generation jobs.
13. Add realtime page playback and prefetch.
14. Package Windows and macOS builds.
15. Plan Android Phase 2.

## Test Plan

Import tests:

- TXT import creates one or more sections.
- EPUB import preserves title, reading order, and TOC.
- Duplicate imports do not create confusing duplicates.
- Invalid files show actionable errors.

Reader tests:

- Left/right regions turn pages.
- Center region toggles controls.
- Controls auto-hide.
- Font/background/brightness settings persist.
- Progress percentage updates and restores after restart.
- TOC navigation opens the correct section.

TTS tests:

- App launch does not load a model.
- First TTS request starts the sidecar.
- Health check works before model load.
- Offline generation reports progress to 100%.
- Cancel stops remaining chunks and preserves completed chunks.
- Realtime playback writes permanent cache chunks.
- Cached chunks replay without regeneration.
- Idle timeout unloads the worker.

Platform tests:

- Windows reports missing CUDA clearly.
- Windows reports missing Qwen model paths clearly.
- macOS packaged app can locate bundled Kokoro resources.
- WAV playback works from app data paths.

Packaging tests:

- Windows package does not include Qwen weights.
- macOS package includes Kokoro resources.
- GitHub clone with Git LFS pulls model files correctly.

## Acceptance Criteria

- A user can import TXT and EPUB books and read them with persistent progress.
- The main screen presents a bookshelf-style library, not a plain file list.
- TTS is never loaded on initial app start.
- Offline and realtime TTS both write to the same permanent WAV cache.
- Windows uses external Qwen models and requires CUDA.
- macOS uses bundled Kokoro.
- The project remains ready for Android Phase 2 without rewriting the reader model.
