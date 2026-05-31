# macOS 安装与构建指南

本目录仅放置 macOS 平台专属的配置与资源；应用本体在 `../desktop/`。

## 前置条件

- macOS 13 或更高版本（Apple Silicon 或 Intel）
- Xcode Command Line Tools：`xcode-select --install`
- Rust 稳定版：`rustup default stable`
- Node.js 20+ 与 pnpm 10+
- Python 3.12

推荐用 Homebrew 一次性装齐：

```sh
brew install node pnpm python@3.12 rustup git-lfs
rustup-init -y
```

## Kokoro 模型权重

macOS 端使用仓库内 Git LFS 管理的 Kokoro 权重。每次新克隆都要拉取：

```sh
git lfs install
git lfs pull
```

模型位置：`../models/Kokoro-82M/kokoro-v1_0.pth`。`tauri.macos.conf.json` 声明这是 bundle 资源，最终打包后的 `.app` 会通过 resource 目录访问。

## 创建 Python TTS 子进程环境

```sh
cd desktop/sidecar
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r ../../macos/sidecar-env/requirements.txt
```

或者直接执行已写好的脚本：

```sh
bash macos/sidecar-env/activate.sh
```

> `kokoro` Python 包安装失败时，Rust 侧的 `sidecar.rs` 会自动 fallback 到 `engine_stub`（正弦波模拟），不影响应用启动。

## 开发模式运行

```sh
cd desktop
pnpm install
pnpm tauri dev
```

首次启动需要编译 Rust 依赖，约 3–5 分钟。后续启动几秒。

## 打包 DMG

```sh
cd desktop
pnpm tauri build --bundles dmg
```

签名与公证需要 Apple Developer ID（默认未配置）。如需自动签名，构建前设置：

```sh
export APPLE_ID="..."
export APPLE_PASSWORD="..."
export APPLE_TEAM_ID="..."
```

## 验证清单

- [ ] `pnpm tauri dev` 启动后看到空书架。
- [ ] 终端 `ps aux | grep python` **没有**子进程在跑。
- [ ] 导入一个 TXT → 书脊出现，点击进入阅读器。
- [ ] 左 1/3 → 上一页；右 1/3 → 下一页；中部 → 显示/隐藏底栏；底栏右侧显示百分比。
- [ ] 关闭应用，重新打开 → 阅读位置恢复。
- [ ] 导入带章节的 EPUB → 目录侧栏显示章节列表，点击跳转。
- [ ] 点击 ▶ Play → Python 子进程启动 → 首次合成时 Kokoro 懒加载 → 播放成功。
- [ ] 同一页再次点击 → 瞬间播放，来自 `~/Library/Application Support/com.podcast.reader/audio_cache/`。
- [ ] 闲置 60 秒 → 子进程日志输出 `unloaded`。
- [ ] `pnpm tauri build` 产出的 DMG 内包含 Kokoro 资源。

## 常见问题

### 启动后报 `model_lfs_pointer`

`models/Kokoro-82M/kokoro-v1_0.pth` 还是 LFS 指针（约 1KB）。执行：

```sh
git lfs install
git lfs pull
ls -la models/Kokoro-82M/kokoro-v1_0.pth   # 期望 ≥ 几百 MB
```

### 报 `kokoro_not_installed`

子进程的 Python 环境没装 `kokoro` 包。检查 `desktop/sidecar/.venv/` 是否存在且已激活，必要时重跑 `bash macos/sidecar-env/activate.sh`。

### 端口冲突

子进程默认监听 `127.0.0.1:38219`。被占用时可单独运行验证：

```sh
python desktop/sidecar/main.py --port 38219 --audio-cache ./cache --engine kokoro
```

## 本目录文件

- `README.md` —— 本文档
- `icons/icon.icns` —— macOS 图标占位（发布前替换为正式美术资源）
- `installer/dmg.config.json` —— DMG bundler 配置
- `sidecar-env/requirements.txt` —— Kokoro 子进程 Python 依赖
- `sidecar-env/activate.sh` —— 一键创建并激活 venv 的脚本
