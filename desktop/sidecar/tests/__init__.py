"""Test discovery helper — puts the sidecar root on sys.path."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_tests(loader, standard_tests, pattern):
    return loader.discover(start_dir=str(Path(__file__).resolve().parent), pattern="test_*.py")
