#!/usr/bin/env bash
# Activate the macOS TTS sidecar venv.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/../../desktop/sidecar/.venv"

if [[ ! -d "$venv" ]]; then
    echo "Creating venv at $venv"
    python3.12 -m venv "$venv"
fi

# shellcheck source=/dev/null
source "$venv/bin/activate"
pip install -r "$here/requirements.txt"
