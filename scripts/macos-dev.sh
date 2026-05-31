#!/usr/bin/env bash
# macos-dev.sh — start the Tauri app in development mode.
#
# Assumes scripts/macos-setup.sh has already been run successfully.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$REPO_DIR/desktop/sidecar/.venv"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*"; exit 1; }

bold "==> Podcast Reader · 开发模式启动"

# Sanity checks
[[ -d "$VENV" ]] || fail "Python venv 不存在。先跑：bash scripts/macos-setup.sh"
[[ -d "$REPO_DIR/desktop/node_modules" ]] || fail "node_modules 不存在。先跑：bash scripts/macos-setup.sh"

MODEL_FILE="$REPO_DIR/models/Kokoro-82M/kokoro-v1_0.pth"
if [[ -f "$MODEL_FILE" ]]; then
    size=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE")
    if [[ "$size" -lt 1048576 ]]; then
        fail "Kokoro 模型只有 $size 字节（LFS 指针）。先跑：git lfs pull"
    fi
fi

cd "$REPO_DIR/desktop"

# Tauri 会用 desktop/sidecar/.venv/bin/python 拉起子进程 —— 不需要预激活。
# 但导出 RUST_LOG 让我们能看到详细日志。
export RUST_LOG="${RUST_LOG:-info,podcast_reader_lib=debug,tauri=info}"

bold "==> 启动 pnpm tauri dev"
echo "    首次启动会编译 Rust 后端（约 3-5 分钟），后续启动几秒。"
echo "    日志级别：RUST_LOG=$RUST_LOG"
echo "    退出：Ctrl-C"
echo

exec pnpm tauri dev
