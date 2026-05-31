# macOS 安装与构建指南

本目录仅放置 macOS 平台专属的配置与资源；应用本体在 `../desktop/`。

## 三个一键脚本

仓库根目录下的 `scripts/` 提供了三个脚本，按顺序使用：

| 脚本 | 用途 |
| --- | --- |
| `scripts/macos-setup.sh` | 一次性环境准备：检查工具链、拉 LFS 模型、建 Python venv、装 Kokoro / fastapi 等、`pnpm install` |
| `scripts/macos-dev.sh` | 开发模式启动应用（热重载） |
| `scripts/macos-build.sh` | 打包出 `.app` + `.dmg` 安装包 |

## 完整流程

```sh
# 1. 准备依赖（约 5-10 分钟，含 LFS 模型 ~330 MB + Kokoro Python 包）
bash scripts/macos-setup.sh

# 2. 开发模式启动应用
bash scripts/macos-dev.sh
#    首次启动 Rust 后端编译约 3-5 分钟，之后几秒。
#    应用窗口出现后：
#      a) 右上角 ⚙ 设置 → 引擎 Kokoro 82M → 语言 中文(Mandarin) → 音色 zf_xiaoxiao
#      b) 返回书架 → ＋ 导入书籍 → 选你的 TXT/EPUB
#      c) 打开 → ▶ 播放

# 3. 打包安装包（约 5-10 分钟）
bash scripts/macos-build.sh
#    输出 .dmg 路径会打印在终端最后。
#    .dmg 大小约 400 MB（含 Kokoro 模型权重）。
```

## 前置条件

`macos-setup.sh` 会自动检查这些；缺什么会告诉你怎么装：

- macOS 13 或更高（Apple Silicon 或 Intel）
- Xcode Command Line Tools：`xcode-select --install`
- Homebrew（推荐，用于装其他工具）：https://brew.sh
- Rust 稳定版：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 20+：`brew install node`
- pnpm 10+：`npm install -g pnpm@10`
- Python 3.12+：`brew install python@3.12`
- Git LFS：`brew install git-lfs`

## Kokoro 模型与音色

`scripts/macos-setup.sh` 会执行 `git lfs pull`，把 `models/Kokoro-82M/kokoro-v1_0.pth` 从 1 KB 指针变成约 330 MB 的真权重。验证：

```sh
ls -lh models/Kokoro-82M/kokoro-v1_0.pth
# -rw-r--r--  1 user  staff   327M ...
```

支持的语言（在应用「设置」里切换）：

| 应用里的语言名 | Kokoro lang_code | 音色示例 |
| --- | --- | --- |
| English (American) | a | `af_heart`、`am_adam` |
| English (British) | b | `bf_alice`、`bm_george` |
| **中文 (Mandarin)** | **z** | **`zf_xiaoxiao`、`zm_yunxi`** |
| 日本語 | j | `jf_alpha`、`jm_kumo` |
| Español | e | `ef_dora` |
| Français | f | `ff_siwis` |
| हिन्दी | h | `hf_alpha` |
| Italiano | i | `if_sara` |
| Português (Brasil) | p | `pf_dora` |

第一次切到中文播放时，Kokoro 会下载中文 phonemizer（`misaki[zh]`，~100 MB jieba + pypinyin 数据）到 `~/.cache/`。之后切换很快。

## 验证清单

按顺序逐项确认（也是 `scripts/macos-dev.sh` 启动后的检查项）：

- [ ] 应用启动到空书架，`ps aux | grep python` **没有** TTS 子进程。证明启动时不加载模型。
- [ ] 导入一份 TXT → 书脊出现 → 点击进入阅读器。
- [ ] 左 1/3 上一页；右 1/3 下一页；中部切换控件；右下角显示百分比。
- [ ] 关闭重启 → 阅读位置恢复。
- [ ] 导入带章节的 EPUB → 目录侧栏列出章节 → 点击跳转。
- [ ] 设置页改背景/字号 → 保存 → 重启仍生效。
- [ ] 按 ▶ 播放 → Python 子进程启动 → 第一次合成 Kokoro 加载（约 5-10 秒）→ WAV 播出来。
- [ ] 同一页再次 ▶ → 瞬间播放（命中 `~/Library/Application Support/com.podcast.reader/audio_cache/`）。
- [ ] 切到中文 + `zf_xiaoxiao` → 重新播放一段中文 → 听到真人女声。
- [ ] 闲置 60 秒 → 子进程日志输出 `unloaded`，内存回落。

## 常见问题

### `kokoro_not_installed`
子进程的 Python 环境没装 `kokoro` 包。检查：

```sh
ls -la desktop/sidecar/.venv/bin/python   # 必须存在
desktop/sidecar/.venv/bin/python -c "import kokoro; print(kokoro.__version__)"
```

如果第二条报错，重跑：

```sh
bash scripts/macos-setup.sh
```

### `model_lfs_pointer` 或 `model_path_missing`
LFS 模型没拉下来。检查文件大小：

```sh
ls -lh models/Kokoro-82M/kokoro-v1_0.pth
```

应该几百 MB；如果只有几百字节，运行 `git lfs install && git lfs pull`。

### 中文播放报错或没有声音
第一次中文播放时 `misaki[zh]` 会下载 jieba 字典。如果机器网络受限，提前装：

```sh
desktop/sidecar/.venv/bin/pip install "misaki[zh]"
```

### `pnpm` 命令找不到
`npm install -g pnpm@10`。如果公司内网用私有 NPM 镜像，先设好 `~/.npmrc`。

### Tauri 编译卡住或失败
`pnpm tauri dev` 首次需要编译 200+ 个 Rust crate，约 3-5 分钟。失败时清缓存：

```sh
cd desktop/src-tauri && cargo clean
bash scripts/macos-dev.sh
```

### `.dmg` 装好之后报"未识别的开发者"
没有 Apple Developer ID 时这是预期行为。临时绕过：

```sh
xattr -dr com.apple.quarantine "/Applications/Podcast Reader.app"
```

或：系统设置 → 隐私与安全性 → 仍要打开。

## 签名与公证（可选）

签名 + 公证需要 Apple Developer ID（默认未配置）。如果你有，在调 `scripts/macos-build.sh` 之前导出环境变量：

```sh
export APPLE_ID="..."
export APPLE_PASSWORD="..."           # app-specific password
export APPLE_TEAM_ID="..."
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
bash scripts/macos-build.sh
```

## 本目录文件

- `README.md` —— 本文档
- `icons/icon.icns` —— macOS 图标占位
- `installer/dmg.config.json` —— DMG bundler 配置
- `sidecar-env/requirements.txt` —— Kokoro 子进程 Python 依赖
- `sidecar-env/activate.sh` —— 单独创建并激活 venv 的脚本（被 `macos-setup.sh` 调用）
