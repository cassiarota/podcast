# Reader App Handoff

This repository is a planning and asset handoff package for a native reader app. It is not a finished application yet. The goal is to push this repo to GitHub, clone it in a remote cloud agent, and implement the app from the documents in `docs/`.

## Project Goal

Build a native reader app with local text-to-speech generation:

- Import TXT and EPUB books.
- Show imported books on a realistic bookshelf-style main page.
- Read books with page-turn regions, auto-hiding controls, font/background/brightness settings, content navigation, and reading progress.
- Generate audio offline for a whole book or selected section.
- Play realtime TTS for the current page while caching generated chunks for later offline use.
- Avoid loading heavy TTS models when the app opens.

## Current Status

This repo currently contains:

- Product and implementation planning documents.
- A bundled Kokoro model folder for macOS and future Android work.
- Git LFS rules for model artifacts.
- A working Tauri v2 desktop app (`desktop/`) shared by Windows and macOS, plus a stub Python TTS sidecar that runs without external model dependencies.
- Platform overlay directories (`windows/`, `macos/`) and an Android Phase-2 stub (`android/`).

## Repository Layout

```
desktop/    Tauri v2 + React/TS + Rust + Python sidecar (Windows + macOS shared)
windows/    Windows-only icons, installer config, sidecar Python deps, build README
macos/      macOS-only icons, installer config, sidecar Python deps, build README
android/    Phase 2 stub — restates Android plan, no code yet
docs/       Product + technical plan, cloud-agent handoff
models/     Bundled Kokoro 82M (Git LFS); Qwen lives outside the repo on Windows
```

## Target Architecture

The first implementation should use:

- Tauri v2 for Windows and macOS native desktop builds.
- React, TypeScript, and Vite for the UI.
- Rust/Tauri commands for local app operations, storage, sidecar lifecycle, and secure filesystem access.
- SQLite for book metadata, reading positions, TTS jobs, and cache indexes.
- A lazy Python TTS sidecar that starts only when audio generation or playback is requested.

Android is Phase 2. The shared reader/library concepts should be designed so Android can reuse the core UI and storage model later, but Android should use a bundled Kokoro mobile-appropriate runtime instead of the desktop Python sidecar.

## Model Layout

Windows uses external Qwen models already present on the Windows development machine:

```text
D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice
D:\models\Qwen3-TTS-Tokenizer-12Hz
```

Do not copy Qwen into this repository.

macOS and Android use bundled Kokoro assets:

```text
models/Kokoro-82M/
```

The Kokoro model files are large and must be tracked with Git LFS.

## Git LFS

Before committing or pushing model files, initialize Git LFS:

```powershell
git lfs install
git add .gitattributes
git add models/
```

After cloning in the cloud agent, run:

```powershell
git lfs install
git lfs pull
```

## Remote Implementation Instructions

1. Create a GitHub repository from this folder.
2. Ensure Git LFS is installed before committing `models/`.
3. Push the repo to GitHub.
4. Clone it in the remote cloud agent.
5. Read `docs/cloud-agent-handoff.md` first.
6. Implement the app from `docs/reader-app-plan.md`.

## First Implementation Milestone

Build a minimal desktop reader shell:

- Tauri v2 + React/TypeScript/Vite scaffold. ✅ (`desktop/`)
- SQLite metadata store. ✅
- TXT + EPUB import. ✅
- Bookshelf view with generated shelf asset placeholder. ✅
- Reader view with pagination, progress, and bottom controls. ✅
- Lazy Python TTS sidecar with stub engine for offline development. ✅

Real Kokoro / Qwen integration is wired (`desktop/sidecar/engine_kokoro.py`, `engine_qwen.py`) but requires the corresponding model files + Python dependencies to be installed locally. See `macos/README.md` and `windows/README.md`.

## Quick Start

```sh
# 1. Install JS deps and run the desktop app
cd desktop
pnpm install
pnpm tauri dev

# 2. Optional: enable real Kokoro on macOS
git lfs pull
bash ../macos/sidecar-env/activate.sh
```

## Running tests

```sh
# Rust unit tests for pure modules (no Tauri runtime needed)
cd desktop/src-tauri && cargo test

# Python sidecar tests
cd desktop/sidecar
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest
```

## Documentation

- `docs/reader-app-plan.md` contains the full product and technical plan.
- `docs/cloud-agent-handoff.md` contains the remote agent development order and verification checklist.
- `models/README.md` explains the bundled model strategy.
