# 远程开发交接说明

## 目的

本仓库准备给远程实施者使用。**不要**当成既有应用对待 —— 它是一份包含方案与模型资产的交接包。

## 从这里开始

1. 阅读 `README.md`。
2. 阅读 `docs/reader-app-plan.md`。
3. 确认 Git LFS 已拉取 `models/Kokoro-82M/kokoro-v1_0.pth`。
4. 理解架构与平台拆分**之后**再脚手架。

## 环境预期

桌面端实施：

- Node.js 当前 LTS 或项目选定的稳定版
- Rust 稳定工具链
- Tauri v2 CLI 与前置依赖
- Python 3.12 环境用于 TTS 子进程
- SQLite 工具或 Rust SQLite crate

Windows TTS：

- NVIDIA CUDA 兼容机器
- 外部模型路径：
  - `D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice`
  - `D:\models\Qwen3-TTS-Tokenizer-12Hz`
- 子进程环境安装 `qwen-tts` Python 包

macOS TTS：

- 使用 `models/Kokoro-82M` 内绑定的 Kokoro 资产
- macOS 端不需要 Qwen

Android Phase 2：

- **不要**先做 Android
- 保持数据模型与 UI 概念可移植
- 单独规划移动 Kokoro 与匹配的移动运行时

## 开发顺序

### Milestone 1：阅读器壳

- 创建 Tauri v2 + React + TypeScript + Vite 脚手架
- 添加 library ↔ reader 的导航
- 添加 SQLite 设置与迁移
- 实现 TXT 导入
- 渲染书架页（可用占位 / 生成的书架素材）
- 书项以"书脊 + 标题"形态呈现
- 实现阅读分页与位置持久化
- 实现左 / 右 / 中 三块轻触区
- 实现底部控件自动隐藏
- 实现阅读进度百分比

本里程碑**不要**实现 TTS。

### Milestone 2：阅读完成态

- 添加 EPUB 导入
- 添加 TOC / 目录面板
- 添加字号预设
- 添加 10 种背景预设（含护眼绿）
- 添加亮度控制
- 生成书架美术 + 打磨书架排版

### Milestone 3：TTS 基础设施

- 添加音频缓存 schema
- app 数据目录下的缓存目录管理
- Tauri 管理的 Python 子进程生命周期
- 实现 `/healthz` 与就绪检查
- 验证应用可以拉起 / 停止子进程而**不**加载任何模型
- 添加 worker 空闲超时

### Milestone 4：Kokoro 路径

- 用 `models/Kokoro-82M` 绑定资源实现 Kokoro TTS
- 生成 WAV 块
- 块元数据落 SQLite
- 阅读器从缓存播放 WAV 块
- 验证实时当前页播放会写入**永久缓存**

### Milestone 5：Qwen 路径

- 实现 Windows Qwen 引擎
- 生成前校验 CUDA
- 校验外部 Qwen 模型路径
- 用选定的基础音色生成 WAV 块
- 显式上报 CUDA / 模型路径缺失错误

### Milestone 6：离线任务

- 添加全书与选定章节生成
- 添加进度 UI
- 添加取消行为
- 取消或失败后保留已完成块
- 复用已缓存块，**不**重新生成

### Milestone 7：打包

- 不绑定 Qwen 的情况下构建 Windows 桌面包
- 绑定 Kokoro 资源构建 macOS 桌面包
- 验证 app 数据、SQLite、缓存音频在重启后仍存活
- 文档化构建命令与平台前置依赖

## 不能先做的事

- Android **不**能先于桌面端阅读基础。
- **不**能在应用启动时加载 TTS 模型。
- **不**能把 Qwen 权重塞进仓库。
- **不**能做营销首页。
- **不**能在导入 / 分页 / 阅读状态稳定**之前**做 TTS。
- **不**能让实时音频只在临时位置；实时块必须进入永久缓存。

## 验收清单

里程碑视为完成前必须确认：

- 跑了相关单元 / 集成测试
- 在可执行的目标平台本地跑过应用
- 应用正常启动**不**加载模型
- 已导入的书在重启后仍存在
- 已生成的音频块被索引并可重放
- 各平台模型路径已文档化
- 大文件模型走 Git LFS

## 交接备注

远程实施者的**首个有用 PR** 应当只包含：应用脚手架、存储基础、TXT 导入、书架页、阅读页。把 TTS 留到第二个 PR 能让核心阅读流程更易验证，再让模型复杂度入场。
