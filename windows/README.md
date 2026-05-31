# Windows Platform Overlay

This directory holds Windows-only configuration and assets for the Tauri app. The actual app code lives in `../desktop/`.

## Build prerequisites

- Windows 10/11 x64
- NVIDIA GPU with current CUDA drivers (Qwen TTS requires CUDA — no CPU fallback in v1)
- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload
- WebView2 runtime (preinstalled on Windows 11)
- Rust stable: `rustup default stable`
- Node.js 20+ and pnpm 10+
- Python 3.12

## Required external model layout

Qwen weights are **not** included in the installer. Place them at these exact paths before launching the app:

```
D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice
D:\models\Qwen3-TTS-Tokenizer-12Hz
```

If the model directories are missing the app surfaces `model_path_missing` with the offending paths. If CUDA is unavailable it surfaces `cuda_missing`.

## Sidecar Python environment

The TTS sidecar runs as a child process spawned by Tauri. On Windows it uses a venv at `desktop/sidecar/.venv`:

```powershell
cd desktop\sidecar
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r ..\..\windows\sidecar-env\requirements.txt
```

`requirements.txt` includes `torch` built for CUDA 12.1 and the `qwen-tts` package.

## Build the desktop binary

```powershell
cd desktop
pnpm install
pnpm tauri build --target x86_64-pc-windows-msvc
```

The bundler produces an MSI in `desktop\src-tauri\target\release\bundle\msi\`. The MSI ships the app + sidecar Python launcher but **not** Qwen weights.

## Verification checklist (run on the Windows + CUDA box)

This is the only place these checks can run — the Mac development environment cannot exercise the Qwen path.

- [ ] `pnpm tauri dev` launches the app.
- [ ] Initial state: `Get-Process python*` finds no sidecar process.
- [ ] Trigger Realtime Play on a page. A `python.exe` child of the Tauri app appears.
- [ ] `GET http://127.0.0.1:38219/healthz` returns 200 immediately.
- [ ] First synth call loads Qwen — RAM/VRAM jumps once. Subsequent calls are fast.
- [ ] Cache: replay the same page → no new generation, plays instantly from `%APPDATA%/com.podcast.reader/audio_cache/`.
- [ ] Move `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice` aside → app reports `model_path_missing` with the path.
- [ ] On a non-CUDA test machine → app reports `cuda_missing`.
- [ ] Idle 60 seconds → sidecar logs `unloaded`, VRAM drops back.
- [ ] Build the MSI → install on a clean Windows VM → confirm the MSI does NOT contain anything under `D:\models\`.

## Files in this directory

- `README.md` — this file.
- `icons/icon.ico` — Windows app icon (replace with real artwork before shipping).
- `installer/wix.config.json` — overrides for the WiX MSI bundler.
- `sidecar-env/requirements.txt` — Python deps for the Qwen sidecar.
- `sidecar-env/activate.ps1` — convenience activation script.
