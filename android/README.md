# Android（Phase 2）

Phase 2 已实现：完整的 Android Studio 工程，复用桌面端的 SQLite schema、分页算法、缓存键算法，UI 用 Jetpack Compose，TTS 用 ONNX Runtime Mobile 在进程内跑 Kokoro 量化模型。

## 工程结构

```
android/
├── app/
│   ├── build.gradle.kts                  应用模块依赖
│   ├── proguard-rules.pro
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml
│       │   ├── java/com/podcast/reader/
│       │   │   ├── PodcastReaderApp.kt   Application 入口，懒初始化 DB / 仓库 / TTS 管理器
│       │   │   ├── MainActivity.kt       Compose 入口
│       │   │   ├── data/                 Room 实体 + DAO + Repository
│       │   │   ├── importer/             TXT / EPUB 导入（与桌面端 import_txt.rs 对齐）
│       │   │   ├── reader/Paginator.kt   分页算法（PAGE_BYTES=1800、段落/空格回退、UTF-8 边界）
│       │   │   ├── tts/                  Engine 接口 + StubEngine + KokoroOnnxEngine + TtsManager
│       │   │   ├── ui/                   Compose 屏幕：Library / Reader / Controls / TOC / Theme
│       │   │   ├── viewmodel/            Library / Reader / Settings ViewModels
│       │   │   └── util/Hashing.kt
│       │   ├── res/                      strings、themes、drawable、mipmap
│       │   └── assets/kokoro/            **运行前需手动放置** ONNX 模型与音色文件
│       └── test/                         JVM 单元测试（不需要设备）
├── build.gradle.kts                      根 Gradle 配置
├── settings.gradle.kts
├── gradle.properties
├── gradle/libs.versions.toml             版本统一管理
├── gradle/wrapper/gradle-wrapper.properties
└── README.md                             本文档
```

## 前置条件

- Android Studio Ladybug 2024.2 或更高（含 AGP 8.7+）
- JDK 17
- Android SDK 35（compileSdk）
- minSdk 26（Android 8.0 / Oreo）
- 物理设备或模拟器需 ≥ 2 GB 可用 RAM 才能跑 Kokoro 推理；演示用的 stub 引擎几十 MB 即可

## 首次构建

```sh
cd android
# 生成 wrapper jar（仓库不提交二进制 jar）
gradle wrapper
./gradlew :app:assembleDebug
```

如果机器上没有 `gradle` 命令，可以直接用 Android Studio 打开 `android/` 目录，IDE 会自动下载 Gradle 与依赖。

## 跑 JVM 单元测试

不需要设备，纯 JVM：

```sh
cd android
./gradlew :app:testDebugUnitTest
```

覆盖：
- `PaginatorTest` —— 分页与桌面 Rust 端等价
- `CacheKeyTest` —— 缓存键算法与桌面端等价（同一文本得到同一哈希）
- `TxtImporterTest` —— TXT 分章节与回退标题
- `EpubHtmlStrippingTest` —— HTML → 纯文本剥离
- `HashingTest` —— SHA-256 与已知向量对齐

## 真机 / 模拟器跑应用

```sh
./gradlew :app:installDebug
adb shell am start -n com.podcast.reader/.MainActivity
```

启动后：

1. 主屏是空书架。点击底部 **＋ 导入书籍**。
2. Storage Access Framework 弹出系统文件选择器，选一份 `.txt` 或 `.epub`。
3. 书脊出现 → 点击进入阅读器。
4. 屏幕左 1/3 上一页，右 1/3 下一页，中 1/3 切换底栏。
5. 阅读位置按"文本字节偏移"记录，重启后恢复。

## TTS 引擎

应用启动**不**加载 TTS 模型。第一次按 ▶ 播放时：

1. `TtsManager.ensureEngine()` 优先创建 `KokoroOnnxEngine`。
2. `KokoroOnnxEngine.load()` 从 `assets/kokoro/kokoro_int8.ort` 加载模型到缓存目录。
3. 找不到模型 → 抛 `EngineNotReadyException(reason="model_path_missing")`。在这种情况下 `TtsManager` 会回落到 `StubEngine`（产正弦波 WAV），保证 UI 流程可走通。
4. 音频 WAV 落盘到 `filesDir/audio_cache/`，元数据写入 Room `audio_chunks` 表。
5. 缓存键 = `sha256(文本哈希 | engine | voice | language | speed)`，与桌面端**完全一致**。

### 准备真实 Kokoro ONNX 模型

PyTorch 浮点模型 (~330 MB) 对移动端太大，需要先量化转 ONNX：

```sh
# 在桌面 macOS / Linux 上执行（需要 torch + kokoro + onnxruntime）
pip install torch onnx onnxruntime kokoro
git lfs pull   # 拉取 models/Kokoro-82M/kokoro-v1_0.pth
python scripts/convert_kokoro_to_onnx.py \
    --model models/Kokoro-82M/kokoro-v1_0.pth \
    --out android/app/src/main/assets/kokoro \
    --voices af_heart af_sky am_adam
```

转换完成后 `android/app/src/main/assets/kokoro/` 下会出现：

```
kokoro_int8.ort
voices/af_heart.bin
voices/af_sky.bin
voices/am_adam.bin
```

重新构建 APK / AAB，包内即可包含模型。`assets/` 下的内容**不**会被 ProGuard 优化掉。

> 转换脚本 `scripts/convert_kokoro_to_onnx.py` 是骨架 —— 具体输入名 / 张量形状随 `kokoro` Python 包版本变化，必要时修改脚本顶部的 `MODEL_INPUT_NAMES`，并确保 `KokoroOnnxEngine.synthesize()` 里的输入名与之保持一致。

## 已实现 vs 待办

已实现：
- Room 数据层、TXT/EPUB 导入、分页、阅读位置持久化
- 书架 + 阅读器 Compose UI、左右中点击区、自动隐藏底栏、目录侧栏
- 10 套背景主题（含护眼绿）、字号、亮度
- StubEngine（纯 stdlib，立刻可跑）
- KokoroOnnxEngine 骨架（接 ONNX Runtime Mobile，依赖外部转换好的模型）
- 进程内 TTS 调用，WAV 缓存、Room 索引、缓存命中复用
- JVM 单元测试 5 个

待办（不影响 Phase 2 验收）：
- 真正的 Kokoro phoneme tokenizer（当前用占位 ASCII 截断）
- 离线全书生成 + 进度条 UI（桌面端 M6 的移动端对应）
- 实时下一页预取
- MediaPlayer 替换为 ExoPlayer 以便低延迟拼接
- 应用图标真美术（目前 mipmap 是占位字母 P）

## 与桌面端的不变量对齐

| 不变量 | 桌面实现 | Android 实现 |
| --- | --- | --- |
| 分页算法 | `import_txt.rs::paginate` | `Paginator.paginate` |
| 缓存键 | `cache.rs::cache_key` | `tts/CacheKey.derive` |
| HTML 剥离 | `import_epub.rs::html_to_text` | `EpubImporter.htmlToText` |
| SQLite schema | `db.rs::migrate` | `data/entity/Entities.kt` + Room schema |
| 启动不加载模型 | Tauri 不启 sidecar | `TtsManager` 懒构造 + `Engine.load()` |
| 阅读位置按字节偏移 | `reading_positions.source_offset` | `ReadingPositionEntity.sourceOffset` |

如果未来桌面端调整任一不变量，Android 端必须同步更新并补测试。
