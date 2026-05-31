# Windows 构建与验证（英文版索引）

中文安装详细步骤见 [`INSTALL_zh-CN.md`](INSTALL_zh-CN.md)（推荐）。

本目录放置 Windows 平台专属的配置、图标、安装包脚本、Python 环境清单。应用本体在 `../desktop/`。

## 关键路径与约定

- Qwen 模型**不打包**入仓库，需手动放置：
  - `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice`
  - `D:\models\Qwen3-TTS-Tokenizer-12Hz`
- Python 子进程环境位于 `..\desktop\sidecar\.venv`（venv 路径由 Rust `sidecar.rs::which_python` 查找）。
- 应用通过 `%APPDATA%\com.podcast.reader\` 存放 SQLite 和音频缓存。

## 快速构建

```powershell
cd desktop
pnpm install
pnpm tauri build --target x86_64-pc-windows-msvc
```

MSI 输出位置：

```
desktop\src-tauri\target\release\bundle\msi\
```

## 验证清单（必须在带 CUDA 的 Windows 机器上执行）

- [ ] `pnpm tauri dev` 启动成功。
- [ ] 启动时 `Get-Process python*` 无子进程。
- [ ] 点击 ▶ Play 后 `python.exe` 作为 Tauri 子进程出现。
- [ ] `Invoke-WebRequest http://127.0.0.1:38219/healthz` 立即返回 200。
- [ ] 首次合成时 RAM/VRAM 跳升一次。
- [ ] 同一页第二次播放 → 直接命中 `%APPDATA%\com.podcast.reader\audio_cache\` 缓存。
- [ ] 故意把 `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice` 改名 → 应用返回 `model_path_missing` 并显示该路径。
- [ ] 在无 CUDA 的机器上跑 → 返回 `cuda_missing`。
- [ ] 闲置 60 秒 → 子进程日志输出 `unloaded`，VRAM 回落。
- [ ] MSI 安装到干净的 Windows 虚拟机 → 验证 MSI **不**包含 `D:\models\` 下的任何文件。

## 本目录文件

- `README.md` —— 本文档（索引）
- `INSTALL_zh-CN.md` —— 中文详细安装指南
- `icons/icon.ico` —— Windows 图标占位
- `installer/wix.config.json` —— WiX MSI 打包配置覆盖
- `sidecar-env/requirements.txt` —— Qwen 子进程 Python 依赖
- `sidecar-env/activate.ps1` —— 一键创建并激活 venv 的脚本
