"""Qwen model directories must be overridable so users can load other models.

Regression: the model + tokenizer paths used to be module-level constants
hardcoded to `D:\\models\\Qwen3-TTS-*`, which made it impossible to point the
app at a different checkpoint without editing source. They are now resolved
from QWEN_MODEL_DIR / QWEN_TOKENIZER_DIR (env), with the Windows defaults as a
fallback.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from engine_qwen import DEFAULT_MODEL_DIR, DEFAULT_TOKENIZER_DIR, QwenEngine


class QwenConfigTest(unittest.TestCase):
    def test_defaults_to_windows_install_paths(self) -> None:
        eng = QwenEngine()
        self.assertEqual(eng._model_dir, DEFAULT_MODEL_DIR)
        self.assertEqual(eng._tokenizer_dir, DEFAULT_TOKENIZER_DIR)

    def test_env_vars_override_defaults(self) -> None:
        import os

        prev = {k: os.environ.get(k) for k in ("QWEN_MODEL_DIR", "QWEN_TOKENIZER_DIR")}
        try:
            os.environ["QWEN_MODEL_DIR"] = "/opt/models/my-tts"
            os.environ["QWEN_TOKENIZER_DIR"] = "/opt/models/my-tok"
            eng = QwenEngine()
            self.assertEqual(eng._model_dir, Path("/opt/models/my-tts"))
            self.assertEqual(eng._tokenizer_dir, Path("/opt/models/my-tok"))
        finally:
            for k, v in prev.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_constructor_args_beat_env_vars(self) -> None:
        import os

        prev = os.environ.get("QWEN_MODEL_DIR")
        try:
            os.environ["QWEN_MODEL_DIR"] = "/from/env"
            eng = QwenEngine(model_dir="/from/arg")
            self.assertEqual(eng._model_dir, Path("/from/arg"))
        finally:
            if prev is None:
                os.environ.pop("QWEN_MODEL_DIR", None)
            else:
                os.environ["QWEN_MODEL_DIR"] = prev


if __name__ == "__main__":
    unittest.main()
