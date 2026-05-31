# Cloud Agent Handoff

## Purpose

This repo is prepared for remote implementation. Do not treat it as an existing app. It is a handoff package containing plans and model assets.

## Start Here

1. Read `README.md`.
2. Read `docs/reader-app-plan.md`.
3. Confirm Git LFS pulled `models/Kokoro-82M/kokoro-v1_0.pth`.
4. Scaffold the app only after understanding the architecture and platform split.

## Environment Expectations

Desktop implementation:

- Node.js current LTS or project-selected stable version.
- Rust stable toolchain.
- Tauri v2 CLI and prerequisites.
- Python 3.12 environment for TTS sidecars.
- SQLite tooling or Rust SQLite crate.

Windows TTS:

- NVIDIA CUDA-capable machine.
- External model paths:
  - `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice`
  - `D:\models\Qwen3-TTS-Tokenizer-12Hz`
- `qwen-tts` Python package installed in the sidecar environment.

macOS TTS:

- Use bundled Kokoro assets from `models/Kokoro-82M`.
- Do not require Qwen on macOS.

Android Phase 2:

- Do not start Android first.
- Keep the data model and UI concepts portable.
- Plan mobile Kokoro separately with a mobile-appropriate runtime.

## Development Order

### Milestone 1: Reader Shell

- Create Tauri v2 + React + TypeScript + Vite scaffold.
- Add app navigation between library and reader.
- Add SQLite setup and migrations.
- Implement TXT import.
- Render bookshelf screen with placeholder/generated shelf asset.
- Render book entries as shelf items with titles.
- Implement reader pagination and reading position persistence.
- Implement left/right/center tap regions.
- Implement auto-hiding bottom controls.
- Implement reading progress percentage.

Do not implement TTS in this milestone.

### Milestone 2: Reader Completeness

- Add EPUB import.
- Add TOC/content panel.
- Add font size presets.
- Add 10 background presets, including eye-protect green.
- Add brightness control.
- Add generated bookshelf asset and polish shelf layout.

### Milestone 3: TTS Infrastructure

- Add audio cache schema.
- Add cache directory management in app data.
- Add Tauri-managed Python sidecar lifecycle.
- Implement `/healthz` and readiness checks.
- Verify the app can start and stop the sidecar without loading a model.
- Add worker idle timeout.

### Milestone 4: Kokoro Path

- Implement Kokoro TTS using bundled `models/Kokoro-82M`.
- Generate WAV chunks.
- Store chunk metadata in SQLite.
- Play cached WAV chunks from the reader.
- Verify realtime current-page playback writes permanent cache entries.

### Milestone 5: Qwen Path

- Implement Windows Qwen engine.
- Validate CUDA before generation.
- Validate external Qwen model paths.
- Generate WAV chunks with selected basic voice preset.
- Surface clear errors for missing CUDA/model paths.

### Milestone 6: Offline Jobs

- Add whole-book and selected-section generation.
- Add progress UI.
- Add cancel behavior.
- Preserve completed chunks after cancel or failure.
- Reuse cached chunks instead of regenerating.

### Milestone 7: Packaging

- Build Windows desktop package without bundling Qwen.
- Build macOS desktop package with Kokoro resources.
- Verify app data, SQLite, and cached audio survive restart.
- Document build commands and platform prerequisites.

## What Not To Do First

- Do not implement Android before desktop reader basics work.
- Do not load TTS models at app startup.
- Do not copy Qwen weights into the repo.
- Do not make a landing page.
- Do not build TTS before import, pagination, and reading state are stable.
- Do not use temporary-only realtime audio; realtime chunks must enter the permanent cache.

## Verification Checklist

Before reporting a milestone complete:

- Run the relevant unit/integration tests.
- Run the app locally for the target platform when possible.
- Confirm no model loads on normal app startup.
- Confirm imported books persist after restart.
- Confirm generated audio chunks are indexed and replayable.
- Confirm platform-specific model paths are documented.
- Confirm large model files are handled by Git LFS.

## Handoff Notes

The first useful pull request from the cloud agent should contain only the app scaffold, storage foundation, TXT import, bookshelf view, and reader view. Keeping TTS out of the first PR will make the core reader easier to verify before model complexity enters the project.
