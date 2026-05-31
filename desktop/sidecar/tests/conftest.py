"""Make the sidecar modules importable as `engine_base`, `engine_stub`, ...

The sidecar uses bare module names internally (matches how it's spawned by Tauri).
Tests need the same import surface, so we prepend the sidecar dir to sys.path.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
