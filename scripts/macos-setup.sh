#!/usr/bin/env bash
# macos-setup.sh — one-shot environment setup for Podcast Reader on macOS.
#
# What this does:
#   1. Verifies system prerequisites (Xcode CLT, Rust, Node/pnpm, Python 3.12, Git LFS).
#   2. Pulls the Kokoro model weights via Git LFS (~330 MB).
#   3. Creates a Python venv at desktop/sidecar/.venv and installs Kokoro + Chinese phonemizer.
#   4. Installs JS dependencies via pnpm.
#
# Re-running is safe — every step is idempotent.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# ---------- pretty printing ----------
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

bold "==> Podcast Reader · macOS setup"
echo "    Repo: $REPO_DIR"
echo

# ---------- 1. system prerequisites ----------
bold "==> 1/5 检查系统依赖"

# Xcode Command Line Tools (provides clang, ld, git, ...)
if ! xcode-select -p >/dev/null 2>&1; then
    warn "Xcode Command Line Tools 未安装。运行：xcode-select --install"
    warn "安装完成后重新运行本脚本。"
    exit 1
fi
ok "Xcode Command Line Tools: $(xcode-select -p)"

# Homebrew is optional but used for git-lfs install fallback.
if command -v brew >/dev/null 2>&1; then
    ok "Homebrew: $(brew --prefix)"
else
    warn "Homebrew 未安装（可选）。安装方式见 https://brew.sh"
fi

# Rust
if ! command -v cargo >/dev/null 2>&1; then
    fail "Rust 未安装。运行：curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi
ok "Rust: $(cargo --version)"

# Node + pnpm
if ! command -v node >/dev/null 2>&1; then
    fail "Node.js 未安装。运行：brew install node  （或装 LTS 版）"
fi
ok "Node: $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
    warn "pnpm 未安装，尝试用 npm 全局安装..."
    if command -v npm >/dev/null 2>&1; then
        npm install -g pnpm@10
    else
        fail "npm 也没有 —— 先装 Node.js LTS。"
    fi
fi
ok "pnpm: $(pnpm --version)"

# Python 3.12
PY=""
for cand in python3.12 python3.13 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
        v=$("$cand" -c "import sys; print('%d.%d' % sys.version_info[:2])")
        major=${v%.*}; minor=${v#*.}
        if [[ "$major" == "3" && "$minor" -ge 12 ]]; then
            PY="$cand"
            break
        fi
    fi
done
if [[ -z "$PY" ]]; then
    fail "需要 Python 3.12+。安装：brew install python@3.12"
fi
ok "Python: $($PY --version) ($(command -v $PY))"

# Git LFS
if ! command -v git-lfs >/dev/null 2>&1 && ! git lfs version >/dev/null 2>&1; then
    warn "git-lfs 未安装，尝试用 Homebrew 安装..."
    if command -v brew >/dev/null 2>&1; then
        brew install git-lfs
    else
        fail "git-lfs 未安装且没有 Homebrew。安装方式：https://git-lfs.com"
    fi
fi
ok "Git LFS: $(git lfs version | head -1)"

# ---------- 2. LFS pull (Kokoro 模型权重) ----------
echo
bold "==> 2/5 拉取 Kokoro 模型权重（~330 MB）"
git lfs install
MODEL_FILE="models/Kokoro-82M/kokoro-v1_0.pth"
if [[ -f "$MODEL_FILE" ]]; then
    size=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE")
    if [[ "$size" -lt 1048576 ]]; then
        warn "模型文件仅 $size 字节，看起来还是 LFS 指针。git lfs pull..."
        git lfs pull
    fi
fi
git lfs pull
size=$(stat -f%z "$MODEL_FILE" 2>/dev/null || stat -c%s "$MODEL_FILE")
if [[ "$size" -lt 1048576 ]]; then
    fail "Kokoro 模型仍然只有 $size 字节。检查 LFS 配额或网络。"
fi
ok "Kokoro 模型: $((size / 1024 / 1024)) MB"

# ---------- 3. Python venv + Kokoro deps ----------
echo
bold "==> 3/5 创建 Python 子进程环境并安装 Kokoro"
VENV="$REPO_DIR/desktop/sidecar/.venv"
if [[ ! -d "$VENV" ]]; then
    echo "  Creating venv at desktop/sidecar/.venv ..."
    "$PY" -m venv "$VENV"
fi

# Pip install — torch is pulled in transitively by kokoro.
# On Apple Silicon the default torch wheel uses MPS; on Intel it falls back to CPU.
"$VENV/bin/pip" install --upgrade pip --quiet
echo "  pip install (kokoro + misaki[zh] + fastapi …)  —— 首次约 2-5 分钟"
"$VENV/bin/pip" install -r "$REPO_DIR/macos/sidecar-env/requirements.txt"

# Quick smoke check: kokoro must be importable.
if ! "$VENV/bin/python" -c "import kokoro" 2>/dev/null; then
    fail "kokoro 包未能成功安装。手动执行：$VENV/bin/pip install kokoro"
fi
ok "Python deps installed (venv at $VENV)"

# ---------- 4. JS deps ----------
echo
bold "==> 4/5 安装 JS 依赖"
cd "$REPO_DIR/desktop"
pnpm install
cd "$REPO_DIR"
ok "pnpm install 完成"

# ---------- 5. final summary ----------
echo
bold "==> 5/5 完成！下一步可以做以下任一："
echo
echo "    开发模式（热重载，推荐第一次跑）："
echo "        bash scripts/macos-dev.sh"
echo
echo "    打包 .dmg 安装包："
echo "        bash scripts/macos-build.sh"
echo
echo "    在应用里设置中文 Kokoro："
echo "        右上角 ⚙ 设置 → 引擎 Kokoro 82M → 语言 中文(Mandarin) → 音色 zf_xiaoxiao"
echo
