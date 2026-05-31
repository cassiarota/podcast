"""Verify the sidecar never imports heavy ML packages at module scope.

The plan's core invariant: no TTS model loads at app launch. The Rust side
spawns the sidecar lazily, AND the sidecar's main module must not pull in
torch/kokoro/qwen until an engine's `load()` runs.
"""

from __future__ import annotations

import importlib
import sys
import unittest


def _purge(prefixes: list[str]) -> None:
    for mod_name in list(sys.modules):
        if any(mod_name == p or mod_name.startswith(p + ".") for p in prefixes):
            del sys.modules[mod_name]


class LazyImportsTest(unittest.TestCase):
    def test_engine_kokoro_does_not_import_torch_or_kokoro_at_module_scope(self) -> None:
        _purge(["engine_kokoro", "torch", "kokoro"])
        importlib.import_module("engine_kokoro")
        self.assertNotIn("torch", sys.modules)
        self.assertNotIn("kokoro", sys.modules)

    def test_engine_qwen_does_not_import_torch_or_qwen_at_module_scope(self) -> None:
        _purge(["engine_qwen", "torch", "qwen_tts"])
        importlib.import_module("engine_qwen")
        self.assertNotIn("torch", sys.modules)
        self.assertNotIn("qwen_tts", sys.modules)

    def test_engine_stub_imports_cleanly_with_only_stdlib(self) -> None:
        _purge(["engine_stub", "numpy", "torch", "kokoro", "qwen_tts"])
        importlib.import_module("engine_stub")
        # The stub MUST work without any third-party deps.
        for forbidden in ("numpy", "torch", "kokoro", "qwen_tts"):
            self.assertNotIn(forbidden, sys.modules, f"engine_stub leaked a {forbidden} import")

    @unittest.skipUnless(
        importlib.util.find_spec("fastapi") is not None, "fastapi not installed"
    )
    def test_main_module_has_no_torch_imports(self) -> None:
        _purge(["main", "engine_base", "engine_stub", "engine_kokoro", "engine_qwen", "torch", "kokoro", "qwen_tts"])
        importlib.import_module("main")
        self.assertNotIn("torch", sys.modules, "main.py must not import torch at module scope")
        self.assertNotIn("kokoro", sys.modules, "main.py must not import kokoro at module scope")
        self.assertNotIn("qwen_tts", sys.modules, "main.py must not import qwen_tts at module scope")


if __name__ == "__main__":
    unittest.main()
