# macOS Platform Overlay

This directory holds macOS-only configuration and assets for the Tauri app. The app code itself lives in `../desktop/`.

## Build prerequisites

- macOS 13+ (Apple Silicon or Intel)
- Xcode Command Line Tools: `xcode-select --install`
- Rust stable: `rustup default stable`
- Node.js 20+ and pnpm 10+
- Python 3.12

## Bundled model layout

macOS ships with Kokoro 82M as bundled resources. Before any build, pull the LFS-managed weights:

```sh
git lfs install
git lfs pull
```

The Kokoro model lives at `../models/Kokoro-82M/kokoro-v1_0.pth`. `tauri.macos.conf.json` declares it as a bundle resource, so the packaged `.app` finds it via the resource directory.

## Sidecar Python environment

The TTS sidecar runs as a child process. Create the macOS venv:

```sh
cd desktop/sidecar
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r ../../macos/sidecar-env/requirements.txt
```

`requirements.txt` includes `fastapi`, `uvicorn`, `numpy`, `soundfile`, and the optional `kokoro` package.

## Run in dev mode

```sh
cd desktop
pnpm install
pnpm tauri dev
```

## Build the desktop binary

```sh
cd desktop
pnpm tauri build --bundles dmg
```

Signing and notarization require an Apple Developer ID (not configured here). Set `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` env vars before `pnpm tauri build` to sign automatically.

## Verification checklist

- [ ] `pnpm tauri dev` launches the app to an empty shelf.
- [ ] No Python process is running (`ps aux | grep python`).
- [ ] Import a TXT → tile appears, click → reader opens.
- [ ] Page-turn left/right works; center toggles controls; bottom-right shows progress %.
- [ ] Restart the app → reading position restored.
- [ ] Import an EPUB → TOC panel lists chapters → click navigates.
- [ ] Press Realtime Play → sidecar starts → first call loads Kokoro lazily → WAV plays.
- [ ] Replay → instant from `~/Library/Application Support/com.podcast.reader/audio_cache/`.
- [ ] Idle 60 seconds → sidecar logs `unloaded`.
- [ ] `pnpm tauri build` produces a DMG containing the Kokoro resources.

## Files in this directory

- `README.md` — this file.
- `icons/icon.icns` — macOS app icon (replace with real artwork before shipping).
- `installer/dmg.config.json` — DMG bundler overrides.
- `sidecar-env/requirements.txt` — Python deps for the Kokoro sidecar.
- `sidecar-env/activate.sh` — convenience activation script.
