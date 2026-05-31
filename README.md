# Podcast Reader

一个原生本地阅读应用，支持导入 TXT 和 EPUB 书籍，并通过本地 TTS（文本转语音）引擎离线生成或实时播放音频。

- **桌面端**（Windows + macOS）：基于 Tauri v2，React/TypeScript 前端，Rust 后端，SQLite 存储。TTS 通过懒加载的 Python 子进程提供。
- **Android**：作为 Phase 2 规划，UI 复用桌面端概念，TTS 在进程内通过 ONNX Runtime 跑 Kokoro。
- **TTS 引擎**：Windows 使用 **Qwen**（需要 CUDA 显卡），macOS 使用 **Kokoro**（CPU 即可），Android 未来用 Kokoro ONNX 量化版本。所有引擎都"用到才加载"，应用启动**不会**加载任何模型。

## 仓库结构

```
desktop/    Windows + macOS 共享的 Tauri 应用（React/TS + Rust + Python 子进程）
windows/    Windows 平台专属资源（图标、MSI 配置、CUDA Python 环境、安装说明）
macos/      macOS 平台专属资源（图标、DMG 配置、Kokoro Python 环境、安装说明）
android/    Android Phase 2 占位（暂未实现）
docs/       产品方案与技术文档
models/     Kokoro 模型权重（Git LFS 管理），Windows 用的 Qwen 不在仓库内
scripts/    端到端 demo 脚本（用 stub 引擎演示完整流程）
demo.txt    用于 demo 的示例文本
```

## 平台支持

| 平台 | UI 框架 | TTS 引擎 | 状态 |
| --- | --- | --- | --- |
| Windows 10/11 x64 | Tauri v2 + React/TS | Qwen（需 CUDA） | 已实现，待在真实 Windows + CUDA 环境验证 |
| macOS 13+ | Tauri v2 + React/TS | Kokoro（CPU） | 已实现，可在本地运行 |
| Android 8+ | Jetpack Compose | Kokoro ONNX（int8） | Phase 2 工程已实现，量化模型需 `scripts/convert_kokoro_to_onnx.py` 离线产出 |

## 快速开始

### macOS

```sh
# 1. 安装依赖（一次性）
brew install node pnpm python@3.12 rustup git-lfs
rustup-init -y
git lfs install

# 2. 拉取仓库与模型权重
git clone https://github.com/cassiarota/podcast.git
cd podcast
git lfs pull

# 3. 准备 Python TTS 子进程环境（Kokoro）
bash macos/sidecar-env/activate.sh

# 4. 启动桌面应用
cd desktop
pnpm install
pnpm tauri dev
```

详细步骤与验证清单见 [`macos/README.md`](macos/README.md)。

### Windows

详细步骤见 [`windows/INSTALL_zh-CN.md`](windows/INSTALL_zh-CN.md)（推荐）或英文版 [`windows/README.md`](windows/README.md)。

简要流程：

```powershell
# 1. 安装 VS Build Tools + Rust + Node.js + Python 3.12 + Git LFS
# 2. 准备 Qwen 模型至 D:\models\ 下两个目录（见详细文档）
# 3. 创建 Python 环境
cd desktop\sidecar
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --index-url https://download.pytorch.org/whl/cu121 torch
pip install -r ..\..\windows\sidecar-env\requirements.txt

# 4. 启动应用
cd ..\..
cd desktop
pnpm install
pnpm tauri dev
```

### Android

Phase 2 已实现完整 Android Studio 工程，使用 Kotlin + Jetpack Compose + Room + ONNX Runtime Mobile。详见 [`android/README.md`](android/README.md)。

简要流程：

```sh
# 1. 用 Android Studio 打开 android/ 目录，或在命令行：
cd android
gradle wrapper           # 生成 wrapper jar（仓库不提交二进制）
./gradlew :app:assembleDebug

# 2. （可选）准备真实 Kokoro ONNX 模型
git lfs pull
pip install torch onnx onnxruntime kokoro
python scripts/convert_kokoro_to_onnx.py

# 3. 安装到设备
./gradlew :app:installDebug
```

未放置真模型时应用自动回落到 stub 引擎，可走通完整流程（含正弦波 demo 音频）。

## 使用方法

应用启动后默认进入**书架**界面。

### 导入书籍

- 点击右下角 **+ Import a book**。
- 选择本地 `.txt` 或 `.epub` 文件。
- 导入成功后会出现一张书脊，标题显示在书脊上。

### 阅读

- 点击书脊进入阅读模式。
- 屏幕分为三个区域：
  - **左侧 1/3**：上一页
  - **中间 1/3**：显示/隐藏底部控制栏
  - **右侧 1/3**：下一页
- 也可用键盘 ← / → 翻页，**Esc** 返回书架。
- 阅读位置按"文本字节偏移"持久化保存，即使换字号、重新分页，重启后仍能恢复到原位置。

### 阅读设置

底部控制栏（中部点击调出，2 秒无操作自动隐藏）：

- **字号**：S / M / L
- **背景主题**：10 种预设，含护眼绿、米黄、深色、纯黑等
- **亮度**：滑动条调节，作用在 UI 顶层暗化层，不改系统亮度
- **目录**：弹出侧边栏，支持点击章节跳转
- **▶ Play**：触发 TTS 播放当前页
- **⚙ 设置**：进入完整设置页（也可从书架右上角进入）

### 设置页

书架右上角或阅读控制栏点 **⚙ 设置** 进入。可以配置：

- **TTS 引擎**：Kokoro（推荐，多语言，CPU 即可）/ Qwen（Windows + CUDA）/ Stub（调试）
- **语言**：Kokoro 支持 9 种，包括 **中文（Mandarin）**、英、日、西、法、印地、意、葡
- **音色**：按语言过滤；中文有 8 个音色（`zf_xiaoxiao` 等女声 + `zm_yunxi` 等男声）
- **语速**：0.5x – 1.5x
- **字号 / 主题 / 亮度**：同上

> Windows 用户：默认引擎是 Kokoro，**不需要** CUDA 也能用。只在你确实想要 Qwen 的特定音色时才需要走 [`windows/INSTALL_zh-CN.md`](windows/INSTALL_zh-CN.md) 的 Qwen 配置流程。

### TTS（文本转语音）

**关键设计**：应用启动时**不会**加载任何 TTS 模型。

第一次点击 ▶ Play 时：

1. Tauri 启动 Python 子进程。
2. 子进程惰性导入对应引擎（macOS → Kokoro，Windows → Qwen），加载模型权重。
3. 生成 WAV 音频写入本地缓存（`%APPDATA%\com.podcast.reader\audio_cache\` 或 `~/Library/Application Support/com.podcast.reader/audio_cache/`）。
4. 同一页第二次点击播放：**直接读缓存**，不重新生成。
5. 闲置 60 秒后子进程卸载模型，释放显存/内存。

缓存键由 `sha256(文本哈希 | 引擎 | 音色 | 语言 | 语速)` 计算，保证不同模型 / 音色之间不串扰。

## 模型说明

### macOS / Android：Kokoro

仓库内 `models/Kokoro-82M/` 已通过 Git LFS 跟踪。克隆后必须运行：

```sh
git lfs install
git lfs pull
```

否则 `kokoro-v1_0.pth` 只是 1KB 的指针文件，启动 TTS 会报 `model_lfs_pointer` 错误。

### Windows：Qwen（外部）

权重**不打包**进仓库，运行前请手动放置：

```
D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice
D:\models\Qwen3-TTS-Tokenizer-12Hz
```

路径硬编码在 `desktop/sidecar/engine_qwen.py`。修改路径需重新构建。

## 运行测试

```sh
# Rust 单元测试（17 个）
cd desktop/src-tauri
cargo test --lib

# Python 测试（8 个 stdlib 测试 + 8 个 FastAPI 集成测试，后者需 pip 安装 fastapi）
cd desktop/sidecar
python3.12 -m unittest discover -s tests
```

## 运行 Demo（不需要真实 TTS 模型）

```sh
python3.12 scripts/run_demo.py
```

`scripts/run_demo.py` 演示完整流程：导入 `demo.txt` → 分章节分页 → 用 stub 引擎合成 3 段 WAV → 写入 SQLite → 验证缓存命中。输出在 `demo_runtime/audio_cache/`，可用 `afplay`（macOS）或任意播放器试听。

> Stub 引擎产出的是正弦波模拟语音，仅用于打通流程；真正的人声音频需安装 Kokoro 或 Qwen。

## 文档索引

- [`docs/reader-app-plan.md`](docs/reader-app-plan.md) — 完整产品与技术方案
- [`docs/cloud-agent-handoff.md`](docs/cloud-agent-handoff.md) — 开发顺序与验收清单
- [`windows/INSTALL_zh-CN.md`](windows/INSTALL_zh-CN.md) — Windows 中文安装指南（含 Qwen 路径）
- [`windows/README.md`](windows/README.md) — Windows 英文构建说明
- [`macos/README.md`](macos/README.md) — macOS 安装与验证清单
- [`android/README.md`](android/README.md) — Android Phase 2 规划

## 关键设计原则

- **启动不加载模型**：避免几百 MB 的冷启动开销。
- **桌面端共享代码库**：Windows 和 macOS 用同一份 Tauri 工程，平台差异由 `tauri.windows.conf.json` 与 `tauri.macos.conf.json` 表达。
- **离线优先**：所有音频缓存为 WAV 落盘，实时播放与离线生成共用同一份缓存。
- **位置稳定**：阅读进度按源文本字节偏移记录，分页参数变化不丢进度。

## Git LFS

模型文件（`*.pth`、`*.pt`、`*.onnx`、`*.safetensors`）以及 `models/` 目录下所有文件均通过 Git LFS 管理。提交前请执行：

```sh
git lfs install
```

克隆后请执行：

```sh
git lfs pull
```

## 许可证

待补充。
