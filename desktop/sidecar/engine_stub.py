"""Stub engine that emits a deterministic synthetic WAV using only stdlib.

Used for tests and as a fallback when the real engine package isn't installed.
This is what makes the end-to-end demo runnable without a 300MB model download.

The output is a soft sine-wave envelope whose duration scales with text length,
so the cache-key / playback / SQLite-indexing paths are exercised exactly the
same as they would be with a real engine. stdlib-only on purpose — the demo
must run on a fresh checkout without `pip install numpy`.
"""

from __future__ import annotations

import array
import math
import wave
from typing import Optional

from engine_base import Engine

SAMPLE_RATE = 22050
MS_PER_CHAR = 55  # ~18 chars per second — close to natural reading pace.


class StubEngine(Engine):
    name = "stub"

    def __init__(self, reason: Optional[str] = None) -> None:
        self._reason = reason
        self._loaded = False

    def load(self) -> None:
        self._loaded = True

    def unload(self) -> None:
        self._loaded = False

    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        voice: str = "default",
        language: str = "en",
        speed: float = 1.0,
    ) -> int:
        if not self._loaded:
            self.load()
        duration_ms = max(400, int(len(text) * MS_PER_CHAR / max(speed, 0.1)))
        n_samples = int(SAMPLE_RATE * duration_ms / 1000)

        # Map voice → base frequency so different voices sound different.
        base = 180.0 + (hash(voice) % 80)
        pcm = array.array("h")  # signed 16-bit
        attack = max(1, int(n_samples * 0.04))
        release = max(1, int(n_samples * 0.06))
        for i in range(n_samples):
            t = i / SAMPLE_RATE
            # ADSR-ish envelope: ramp up, sustain, ramp down.
            if i < attack:
                env = i / attack
            elif i > n_samples - release:
                env = (n_samples - i) / release
            else:
                env = 1.0
            carrier = math.sin(2 * math.pi * base * t)
            modulator = 0.35 * math.sin(2 * math.pi * 4.0 * t)
            sample = env * (carrier + modulator * carrier) * 0.25
            value = max(-1.0, min(1.0, sample))
            pcm.append(int(value * 32767))

        with wave.open(out_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm.tobytes())

        return duration_ms
