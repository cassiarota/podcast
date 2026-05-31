"""Unit tests for the stub engine.

The stub is what powers tests + the offline demo. If it ever breaks the
demo flow breaks too — keep these passing. stdlib-only, no third-party deps.
"""

from __future__ import annotations

import tempfile
import unittest
import wave
from pathlib import Path

from engine_stub import StubEngine


class StubEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_synthesize_produces_valid_wav(self) -> None:
        engine = StubEngine()
        out = self.tmp / "out.wav"
        duration_ms = engine.synthesize("Hello, world!", str(out), voice="default")

        self.assertTrue(out.exists())
        self.assertGreater(out.stat().st_size, 200)
        self.assertGreater(duration_ms, 0)

        with wave.open(str(out), "rb") as wf:
            self.assertEqual(wf.getnchannels(), 1)
            self.assertEqual(wf.getsampwidth(), 2)
            self.assertGreater(wf.getframerate(), 0)
            actual = int(wf.getnframes() * 1000 / wf.getframerate())
            self.assertLess(abs(actual - duration_ms), 10)

    def test_longer_text_produces_longer_audio(self) -> None:
        engine = StubEngine()
        short_ms = engine.synthesize("Hi.", str(self.tmp / "short.wav"))
        long_ms = engine.synthesize(
            "Hello, this is a much longer line of text with more content.",
            str(self.tmp / "long.wav"),
        )
        self.assertGreater(long_ms, short_ms)

    def test_voice_changes_audio(self) -> None:
        engine = StubEngine()
        a = self.tmp / "a.wav"
        b = self.tmp / "b.wav"
        engine.synthesize("Same text.", str(a), voice="alice")
        engine.synthesize("Same text.", str(b), voice="bob")
        self.assertNotEqual(a.read_bytes(), b.read_bytes())

    def test_unload_then_resynth_still_works(self) -> None:
        engine = StubEngine()
        engine.synthesize("First.", str(self.tmp / "first.wav"))
        engine.unload()
        engine.synthesize("Second.", str(self.tmp / "second.wav"))

    def test_engine_name_is_stub(self) -> None:
        self.assertEqual(StubEngine().name, "stub")


if __name__ == "__main__":
    unittest.main()
