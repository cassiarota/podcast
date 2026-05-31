"""Integration tests for the FastAPI surface (`/healthz`, `/ready`, `/tts/realtime`).

Skipped when fastapi isn't installed (e.g. in a fresh checkout without venv).
In a real dev env (`pip install -r macos/sidecar-env/requirements.txt`) these
all run.
"""

from __future__ import annotations

import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path


_HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None


@unittest.skipUnless(_HAS_FASTAPI, "fastapi not installed — skipping FastAPI API tests")
class TtsApiTest(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient
        from main import State, make_app

        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.state = State(audio_cache=self.tmp / "cache", engine_name="stub", kokoro_model=None)
        self.client = TestClient(make_app(self.state))

    def test_healthz_is_cheap_and_does_not_load_engine(self) -> None:
        resp = self.client.get("/healthz")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"status": "ok"})
        ready = self.client.get("/ready").json()
        self.assertFalse(ready["loaded"])

    def test_realtime_synth_returns_cached_path_and_duration(self) -> None:
        resp = self.client.post("/tts/realtime", json={"text": "Test sentence.", "voice": "default"})
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertIn("cache_key", body)
        self.assertIn("path", body)
        self.assertGreater(body["duration_ms"], 0)
        self.assertTrue(Path(body["path"]).exists())

    def test_realtime_second_call_uses_cache(self) -> None:
        a = self.client.post("/tts/realtime", json={"text": "Cache me."}).json()
        b = self.client.post("/tts/realtime", json={"text": "Cache me."}).json()
        self.assertEqual(a["cache_key"], b["cache_key"])
        self.assertEqual(a["path"], b["path"])

    def test_different_voices_produce_different_keys(self) -> None:
        a = self.client.post("/tts/realtime", json={"text": "Same.", "voice": "alice"}).json()
        b = self.client.post("/tts/realtime", json={"text": "Same.", "voice": "bob"}).json()
        self.assertNotEqual(a["cache_key"], b["cache_key"])

    def test_ready_endpoint_reports_engine_after_synth(self) -> None:
        before = self.client.get("/ready").json()
        self.assertFalse(before["loaded"])
        self.client.post("/tts/realtime", json={"text": "Anything."})
        after = self.client.get("/ready").json()
        self.assertTrue(after["loaded"])
        self.assertEqual(after["engine"], "stub")

    def test_cancel_unknown_job_returns_404(self) -> None:
        resp = self.client.post("/tts/jobs/does-not-exist/cancel")
        self.assertEqual(resp.status_code, 404)

    def test_cache_key_is_deterministic_for_same_inputs(self) -> None:
        a = self.client.post("/tts/realtime", json={"text": "Specific text."}).json()
        b = self.client.post("/tts/realtime", json={"text": "Specific text."}).json()
        self.assertEqual(a["cache_key"], b["cache_key"])
        c = self.client.post("/tts/realtime", json={"text": "Different text."}).json()
        self.assertNotEqual(c["cache_key"], a["cache_key"])
        # Sanity check that hashlib is alive — text hash is part of the key derivation upstream.
        _ = hashlib.sha256(b"Specific text.").hexdigest()


if __name__ == "__main__":
    unittest.main()
