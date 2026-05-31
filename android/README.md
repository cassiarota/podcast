# Android（Phase 2，暂未实现）

根据 `docs/cloud-agent-handoff.md` 与 `docs/reader-app-plan.md`，Android 端作为 Phase 2 实施，**不能先做**。当前目录只保留位置和规划文档，没有代码。

## 目标技术栈

- **UI 框架**：Kotlin + Jetpack Compose
- **TTS 引擎**：ONNX Runtime Mobile + Kokoro 量化（int8），**不**使用桌面端的 Python 子进程方案
- **存储**：通过 Room 或 AndroidX SQLite，复用 `desktop/src-tauri/src/db.rs` 的 schema
- **模型资源**：源头来自 `../models/Kokoro-82M/`，但需要先转成 ONNX 量化版本（PyTorch 浮点权重对移动端太大）

## 桌面端可复用的部分

- **SQLite schema**：books / sections / pages / reading_positions / settings / tts_jobs / audio_chunks
- **缓存键算法**：`sha256(文本哈希 | 引擎 | 音色 | 语言 | 语速)`
- **懒加载约定**：应用启动**不**加载模型，第一次播放才加载
- **UX 通则**：书架首页、左右翻页、中部唤起控件、自动隐藏底栏、阅读进度百分比、10 种背景预设（含护眼绿）

## Android 与桌面的差异

- 没有 Python 子进程 —— 引擎在主进程内通过 ONNX Runtime Mobile 跑
- 没有原生文件对话框 —— 改用 Storage Access Framework 导入 TXT/EPUB
- 翻页区域要兼容 Material 安全区和系统手势

## 启动时机

只有当桌面端的下列里程碑全部稳定后再启动 Phase 2：

- M1：阅读器基础壳
- M2：阅读器完成态（EPUB / TOC / 主题 / 书架素材）
- M3：TTS 子进程基础设施
- M4：macOS Kokoro 路径

详见 `../macos/README.md` 的验证清单。
