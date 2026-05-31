#!/usr/bin/env bash
# macos-build.sh — build the Podcast Reader macOS installer (.dmg).
#
# Output:
#   desktop/src-tauri/target/release/bundle/dmg/Podcast Reader_X.Y.Z_<arch>.dmg
#
# Notes:
#   - First-time build takes 5–10 minutes (Rust release optimization).
#   - The .dmg embeds the Kokoro model weights (~330 MB) so the installed
#     app works out of the box on any other macOS machine — but the user
#     of that machine still needs Python 3.12 + a venv with `kokoro` in it
#     for TTS to actually run. See macos/README.md for the recipient flow.
#   - No code signing is configured. macOS will show "unidentified developer"
#     warning. For signing, set APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID
#     before invoking this script.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$REPO_DIR/desktop/sidecar/.venv"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*"; exit 1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }

bold "==> Podcast Reader · 打包 macOS .dmg"

# ---- sanity checks ----
[[ -d "$VENV" ]] || fail "Python venv 不存在。先跑：bash scripts/macos-setup.sh"
[[ -d "$REPO_DIR/desktop/node_modules" ]] || fail "node_modules 不存在。先跑：bash scripts/macos-setup.sh"

MODEL_FILE="$REPO_DIR/models/Kokoro-82M/kokoro-v1_0.pth"
size=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE" 2>/dev/null || echo 0)
if [[ "$size" -lt 1048576 ]]; then
    fail "Kokoro 模型缺失或还是 LFS 指针（仅 $size 字节）。先跑：git lfs pull"
fi
ok "Kokoro 模型: $((size / 1024 / 1024)) MB（将打包进 .dmg）"

# ---- detect target arch (Apple Silicon vs Intel) ----
ARCH=$(uname -m)
case "$ARCH" in
    arm64)  TAURI_TARGET="aarch64-apple-darwin" ;;
    x86_64) TAURI_TARGET="x86_64-apple-darwin" ;;
    *) fail "未识别架构: $ARCH" ;;
esac
ok "目标架构: $TAURI_TARGET"

# ---- ensure the rust target is installed ----
if ! rustup target list --installed 2>/dev/null | grep -q "^$TAURI_TARGET$"; then
    bold "==> 安装 Rust target: $TAURI_TARGET"
    rustup target add "$TAURI_TARGET"
fi

# ---- build ----
cd "$REPO_DIR/desktop"

bold "==> pnpm tauri build --target $TAURI_TARGET --bundles dmg,app"
echo "    首次约 5-10 分钟。请耐心等待..."
echo
pnpm tauri build --target "$TAURI_TARGET" --bundles dmg,app

# ---- locate output ----
BUNDLE_DIR="$REPO_DIR/desktop/src-tauri/target/$TAURI_TARGET/release/bundle"
DMG=$(find "$BUNDLE_DIR/dmg" -name "*.dmg" 2>/dev/null | head -1 || true)
APP=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" 2>/dev/null | head -1 || true)

echo
bold "==> 打包完成 🎉"
if [[ -n "$DMG" ]]; then
    dmg_size=$(stat -f%z "$DMG" 2>/dev/null || stat -c%s "$DMG")
    echo "    .dmg 安装包 ($((dmg_size / 1024 / 1024)) MB):"
    echo "        $DMG"
    echo
    echo "    用法："
    echo "        open '$DMG'"
fi
if [[ -n "$APP" ]]; then
    echo "    .app 也已生成（可直接拖到 /Applications）:"
    echo "        $APP"
fi

echo
bold "==> 接收方机器上的操作"
cat <<'EOF'
    把 .dmg 拷到目标 macOS 机器后：
      1. 双击 .dmg → 把 Podcast Reader 拖到 Applications。
      2. 首次启动 macOS 会拦截（"未识别的开发者"）：
           - 系统设置 → 隐私与安全性 → 仍要打开
           - 或终端：xattr -dr com.apple.quarantine /Applications/Podcast\ Reader.app
      3. 应用本身能跑（书架 / 阅读 / 设置都正常），但 TTS 需要 Python 子进程。
         如果接收方机器**没有**这份源码仓库，需要再装一遍 Python 依赖：
           - 装 Python 3.12: brew install python@3.12
           - 在 ~/Library/Application Support/com.podcast.reader/sidecar-venv 下建 venv
           - pip install kokoro 'misaki[zh]' fastapi uvicorn pydantic numpy soundfile
         （这一步将来会被 .dmg 内置的引导程序替代。）
EOF
