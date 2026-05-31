# CLAUDE.md — Project rules for Claude Code

> See [`AGENT.md`](AGENT.md) for the canonical contributor rules. This file is the Claude-specific overlay.

## Hard rule: keep all three platforms in sync

When you fix a bug or change an algorithm, **find and fix every parallel implementation in the same commit.** Use the catalog in `AGENT.md` to discover the paired files. Concretely:

- A change to `desktop/src-tauri/src/import_txt.rs::paginate` MUST be matched in `android/app/src/main/java/com/podcast/reader/reader/Paginator.kt` and `scripts/run_demo.py::paginate`.
- A change to `desktop/src-tauri/src/cache.rs::cache_key` MUST be matched in `android/.../tts/CacheKey.kt`, `desktop/sidecar/main.py::_derive_cache_key`, and `scripts/run_demo.py::cache_key`.
- A change to the SQLite schema in `desktop/src-tauri/src/db.rs` MUST be matched in Android's Room entities + the demo script's `MIGRATIONS`.

Failure to do this is the #1 way bugs come back. Past incidents:
- The original "no lowercase letters → heading" heuristic was wrong in both Rust and Kotlin; the bug hit the user only after the Rust code shipped, but the Kotlin code would have failed identically.
- The pagination UTF-8 panic on 道诡异仙.txt was latent in **all three** implementations; only the Rust one crashed at runtime, but Kotlin silently dropped bytes and the Python demo was off-by-one.

## Test-mirroring rule

Add a regression test in every affected test suite, named after the failure mode rather than the fix. The next contributor reading the test list should be able to tell from the names alone which bugs the suite already guards against.

## When in doubt

- If the change feels like "algorithm" (parser, hasher, pagination, normalization, settings schema, engine contract), assume there are 2-3 mirrors.
- If the change feels like "plumbing" (Tauri sidecar lifecycle, Compose UI, Vite config, Gradle), it's likely platform-specific and exempt.
- If you're unsure which bucket it's in, grep for the function name across the repo before editing — duplicated names are a strong signal.
