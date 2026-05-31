# AGENT.md — Working in this repo

Guidance for any AI agent (or human contributor) making changes to this codebase.

## Multi-platform mirroring rule

This project ships the **same business logic across three runtimes**:

| Surface | Where it lives |
| --- | --- |
| Desktop (Win + macOS) | `desktop/src-tauri/src/**` (Rust) + `desktop/sidecar/**` (Python) |
| Android | `android/app/src/main/java/com/podcast/reader/**` (Kotlin) |
| Offline demo / docs | `scripts/run_demo.py` (Python) |

**When you fix a bug or change an algorithm in any of these surfaces, you MUST find and fix every parallel implementation in the same commit.** If the change is purely about engine/runtime plumbing (e.g. how Tauri spawns its sidecar), it's exempt — but anything that touches data structures, importers, paginator, cache keys, settings schema, or heading detection has parallel implementations that will silently diverge.

### Catalog of paired implementations

Treat any change to one of these as a change that needs to land in all of them.

| Concern | Rust desktop | Kotlin Android | Python demo / sidecar |
| --- | --- | --- | --- |
| Section / chapter heading detection | `import_txt.rs::is_heading_line` | `TxtImporter.kt::isHeadingLine` | `scripts/run_demo.py::is_heading_line` |
| TXT pagination | `import_txt.rs::paginate` | `Paginator.kt::paginate` | `scripts/run_demo.py::paginate` |
| EPUB pagination | `import_epub.rs::import_epub_at_path` | `EpubImporter.kt::import` | — |
| HTML → plain text | `import_epub.rs::html_to_text` | `EpubImporter.kt::htmlToText` | — |
| Cache key formula | `cache.rs::cache_key` | `tts/CacheKey.kt::derive` | `desktop/sidecar/main.py::_derive_cache_key`, `scripts/run_demo.py::cache_key` |
| SQLite schema | `db.rs::migrate` | `data/entity/Entities.kt` + Room | `scripts/run_demo.py::MIGRATIONS` |
| TTS engine contract | `desktop/sidecar/engine_base.py::Engine` | `tts/Engine.kt` | (Python is canonical) |
| Settings schema (Reader / TTS) | `reader.rs::ReaderSettings`, `TtsSettings` | `data/LibraryRepository.kt::ReaderSettings`, settings store TBD | — |
| Engine catalog (voices / languages) | `reader.rs::list_engines / kokoro_voices` | TBD (mirror when Settings UI lands on Android) | — |

If you add a new pairing, append it here so the next change has a checklist to work from.

### Test coverage rule

For each cross-platform fix:

1. Write a regression test in **each** affected test suite, not just the one you spotted the bug in.
   - Rust: `desktop/src-tauri/src/<mod>.rs` `#[cfg(test)] mod tests`
   - Kotlin: `android/app/src/test/java/com/podcast/reader/<Name>Test.kt`
   - Python: `desktop/sidecar/tests/test_<name>.py`
2. The test should ideally use a minimal extract of the input that triggered the bug, not a synthetic example, so the test name documents the failure mode.

Examples already in the tree:
- `paginate_handles_real_chinese_novel_passage` (Rust) ↔ `handlesRealChineseNovelPassage` (Kotlin) — both regress on the same 道诡异仙 opening.
- `split_into_sections_does_not_falsely_flag_short_chinese_dialogue` (Rust) ↔ `chineseNarrativeAndDialogueAreNotHeadings` (Kotlin).

### When the parallel implementation diverges intentionally

If a platform genuinely needs different behavior (e.g. Android has no Python sidecar so its engine layer is in-process), document the divergence:

1. Add a comment in both places naming the other and explaining *why* they differ.
2. Add the divergence to this table under "Intentionally divergent".

#### Intentionally divergent

| Concern | Why | Where |
| --- | --- | --- |
| TTS engine transport | Desktop uses an HTTP-over-localhost Python sidecar (Tauri spawns it); Android runs ONNX in-process. | `desktop/src-tauri/src/sidecar.rs` vs `android/app/src/main/java/com/podcast/reader/tts/KokoroOnnxEngine.kt` |
| Model storage on Windows | Qwen ships outside the repo at `D:\models\Qwen3-TTS-*`; macOS/Android Kokoro is LFS-tracked in `models/Kokoro-82M/`. | `desktop/sidecar/engine_qwen.py` vs `engine_kokoro.py` |

## Other working norms

- **Commit messages**: explain *why*, reference the bug observation, and list every file/platform touched. The reviewer should be able to tell from the message alone whether all parallel implementations were updated.
- **Don't bypass LFS**: model weights live behind Git LFS. If you add a new model artifact, update `.gitattributes` and document the size in `models/README.md`.
- **No mocking the database in tests**: integration tests open `Connection::open_in_memory()` (Rust) or use Room's in-memory builder (Android). Don't add a fake DAO layer for tests — past experience showed mock/real divergence masked migration bugs.
- **No new TTS engines without the lazy-load contract**: an engine's module-top imports must not pull in torch / kokoro / qwen_tts. Tests in `desktop/sidecar/tests/test_lazy_imports.py` enforce this. Mirror the test on Android when adding new engines there.
- **Settings schema migrations**: the `settings` table is keyed by name (`reader`, `tts`, etc.). When you add a field, choose JSON-shape backward compatibility (new fields with defaults) so old DB rows still deserialize. Add a test that reads the previous-shape JSON and asserts the new defaults populate.
