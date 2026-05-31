# Reader App 实施方案

## 概述

构建一个 Tauri v2 原生桌面阅读应用，Windows 与 macOS 共用一份 React/TypeScript UI 代码。应用启动**轻量**：启动时不加载任何 TTS 模型。本地 Python TTS 子进程仅在用户触发音频生成或播放时启动，短暂维持模型常驻，达到空闲超时后卸载。

Windows 使用位于 `D:\models` 下的外部 Qwen 模型并需要 CUDA。macOS 使用仓库内 LFS 管理的 Kokoro 权重（`models/Kokoro-82M`）。Android 是 Phase 2，使用绑定的 Kokoro 移动版运行时，而**不是**桌面端的 Python 子进程方案。

## 产品需求

- 导入 TXT 与 EPUB 书籍。
- 主界面以**真实书架**视觉呈现已导入的书。
- 每本书显示为书脊/书皮形态，标题清晰可见。
- 书架底部包含"添加 / 导入"按钮。
- 导入流程提供"立刻生成全书音频"选项。
- 选中书籍即进入阅读模式。
- 阅读页支持**左右轻触翻页**。
- **中部轻触**呼出隐藏控件。
- 底部控件**无操作后自动隐藏**。
- 底部右下角显示**阅读进度百分比**。
- 控件包含：
  - 字号：小 / 中 / 大
  - 背景：10 种预设，含护眼绿
  - 亮度：暗 ↔ 亮
  - 目录 / TOC 按钮
- TTS 支持：
  - 全书离线生成
  - 选定章节离线生成
  - 当前页实时生成并播放
  - 离线任务带进度百分比
  - 离线与实时**共用同一份永久音频缓存**

## 架构

Tauri v2 应用分层如下：

- UI：React + TypeScript + Vite
- 原生壳：Rust / Tauri 命令
- 存储：app 数据目录下的 SQLite
- 资产：生成的书架美术 + 绑定的 Kokoro 资源
- TTS：桌面端通过 Tauri sidecar 管理的懒加载 Python 服务
- 音频缓存：WAV 分块落盘 app 数据目录，索引存 SQLite

前端**禁止**直接读写任意本地文件。文件导入、缓存读取、模型就绪检查、子进程生命周期一律走 Tauri 命令。

## 数据模型

SQLite 表（或等效迁移）：

- `books`：id、title、author、source_format、imported path/hash、created_at
- `sections`：id、book_id、title、order、source range
- `pages`：id、book_id、section_id、page_index、text_hash、content（或指针）
- `reading_positions`：book_id、section_id、page_index、percent、updated_at
- `tts_jobs`：id、book_id、scope、status、progress、engine、voice_preset、created_at
- `audio_chunks`：id、book_id、page/section/chunk id、cache_key、path、duration、engine、voice_preset、text_hash
- `settings`：阅读器默认值 + TTS 默认值

具体 schema 可在实施过程中演进，但 **`cache_key` 必须包含**：源文本哈希、引擎、模型版本/路径、音色、语言、语速 / 风格。

## 导入与分页

TXT 导入：

- 默认按 UTF-8 读取
- 归一化换行符
- 优先按明显标题切章节，否则归为单章
- 优先按真实排版测量分页；v1 可用确定性文本块代替

EPUB 导入：

- 解析 title / author 元数据
- 使用 spine 顺序作为阅读顺序
- 优先使用 EPUB TOC
- 章节存为 sections
- 剥离不支持的脚本 / 样式，保留可读文本

分页要足够稳定，让阅读进度与音频块映射在重启后存活。**字号变更导致分页变化时，按源文本偏移而非页号保留进度。**

## 阅读 UX

阅读界面布局：

- 全屏阅读区
- 左 1/3 → 上一页
- 右 1/3 → 下一页
- 中 1/3 → 切换控件
- 底部控件覆盖在内容上，自动隐藏
- 右下角始终显示阅读进度百分比
- 目录以侧栏或模态弹出

设置：

- 字号预设映射到固定的 typography 值
- 背景预设：白、暖纸、深色、纯黑、灰、米色、低对比、护眼绿，等
- 亮度通过 UI 顶层暗化层或主题调节实现，**不**改系统亮度

## 书架 UX

书架页要**像真书架**，不是普通网格：

- 用生成的 bitmap 书架背景，提交进 app 资产
- 书皮 / 书脊按书架行对齐
- 书脊上突出显示书名
- 底部留出"导入"按钮
- 空状态也展示书架并邀请用户导入

**禁止做营销首页。** 首屏就是可用的图书馆。

## TTS 行为

应用启动时**不加载任何模型**。

生成或实时播放开始时：

1. Tauri 启动或唤醒 Python TTS 服务
2. 服务检查引擎就绪
3. 选定模型懒加载
4. 任务切分成块
5. 每块生成 WAV
6. 块完成时更新 SQLite
7. 进度事件流式回传 UI
8. 空闲超时后 worker 卸载

离线生成：

- scope 可为全书或选定章节
- 状态包括 queued / loading / generating / cached / failed / canceled / completed
- 进度按块计算
- **取消或失败后已完成的块仍可用**

实时生成：

- 默认 scope 为当前页
- 生成并播放可见页
- 预取下一页
- 生成的块写入与离线模式**共用**的永久缓存
- 已缓存则立即从缓存播放

音频格式：

- v1 用 WAV 块保证可靠性
- 压缩格式等播放与打包稳定后再加

## 各平台 TTS 引擎

Windows：

- 使用 Python 包 `qwen-tts`
- 外部模型路径：
  - `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice`
  - `D:\models\Qwen3-TTS-Tokenizer-12Hz`
- 必须 NVIDIA CUDA
- CUDA 或模型路径不可用时弹出清晰的就绪错误
- v1 **不**承诺 CPU 兜底

macOS：

- 使用绑定的 `models/Kokoro-82M`
- Kokoro 资源随应用打包
- 缓存、任务、播放接口与 Windows 完全一致

Android Phase 2：

- 复用阅读 / 书架 UX 概念
- 绑定 Kokoro 资源
- 使用移动端友好的运行时（很可能是 ONNX / int8 或其它移动 Kokoro 管线）
- **不**使用桌面端的 Python 子进程架构

## 对外接口

前端 → Tauri 命令：

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

TTS 服务端点：

- `GET /healthz`
- `GET /ready`
- `POST /tts/jobs`
- `GET /tts/jobs/{id}`
- `GET /tts/jobs/{id}/events`
- `POST /tts/jobs/{id}/cancel`
- `POST /tts/realtime`

## 开发顺序

1. Tauri v2 + React/TypeScript/Vite 脚手架
2. SQLite 存储 + 迁移
3. TXT 导入 + 基础书架
4. 阅读分页 + 进度持久化
5. 阅读控件 + 主题
6. EPUB 导入
7. 生成书架美术
8. 音频缓存 schema + 文件管理
9. Python 子进程壳，只跑健康检查
10. macOS / 通用路径上的 Kokoro 生成
11. Windows CUDA 路径上的 Qwen 生成
12. 离线生成任务
13. 实时页播放 + 预取
14. Windows / macOS 打包
15. 规划 Android Phase 2

## 测试方案

导入测试：

- TXT 导入产生一个或多个章节
- EPUB 导入保留 title、阅读顺序、TOC
- 重复导入不产生混乱副本
- 无效文件给出可操作错误

阅读测试：

- 左右区域翻页
- 中区切换控件
- 控件自动隐藏
- 字号 / 背景 / 亮度持久化
- 进度百分比刷新并在重启后恢复
- TOC 跳转到正确章节

TTS 测试：

- 应用启动不加载模型
- 首次 TTS 请求启动子进程
- 模型加载前 `/healthz` 已可用
- 离线生成进度到 100%
- 取消停止剩余块且保留已完成块
- 实时播放写入永久缓存块
- 缓存块无需重生即可重放
- 空闲超时卸载 worker

平台测试：

- Windows 报告 CUDA 缺失要清晰
- Windows 报告 Qwen 模型路径缺失要清晰
- 打包的 macOS 应用能定位绑定的 Kokoro 资源
- WAV 可从 app 数据路径播放

打包测试：

- Windows 安装包**不**包含 Qwen 权重
- macOS 安装包**包含**Kokoro 资源
- 用 Git LFS 从 GitHub 克隆能正确拉取模型

## 验收标准

- 用户可以导入 TXT/EPUB 并以持久化进度阅读。
- 主界面是书架样式的图书馆，不是普通文件列表。
- 应用初次启动**不会**加载 TTS。
- 离线与实时 TTS 都写入同一份永久 WAV 缓存。
- Windows 使用外部 Qwen 模型且要求 CUDA。
- macOS 使用绑定的 Kokoro。
- 项目随时可以进入 Android Phase 2，**不需要**重写阅读模型。
