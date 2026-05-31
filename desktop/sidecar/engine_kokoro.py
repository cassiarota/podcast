"""Kokoro engine — used by macOS and (in Phase 2) Android via ONNX.

NOTE: heavy imports (numpy, kokoro, torch) happen lazily inside `load()`/`synthesize()`.
Importing this module from `main.py` must not pull in 200MB of weights.
"""

from __future__ import annotations

import wave
from pathlib import Path
from typing import Optional

from engine_base import Engine, NotReadyError

DEFAULT_SAMPLE_RATE = 24000

# Kokoro KPipeline uses a single-letter lang_code. Map our human-readable codes.
LANG_CODE_MAP = {
    "en": "a",       # American English (default)
    "en-US": "a",
    "en-GB": "b",    # British English
    "zh": "z",       # Mandarin Chinese
    "ja": "j",       # Japanese
    "es": "e",       # Spanish
    "fr": "f",       # French
    "hi": "h",       # Hindi
    "it": "i",       # Italian
    "pt-BR": "p",    # Brazilian Portuguese
    "pt": "p",
}


class KokoroEngine(Engine):
    name = "kokoro"

    def __init__(self, model_path: Optional[str] = None) -> None:
        self._model_path = model_path
        self._pipeline = None
        self._pipeline_lang: Optional[str] = None
        self._sample_rate = DEFAULT_SAMPLE_RATE

    def load(self) -> None:
        # Lazy: real pipeline construction happens on the first synth call,
        # which is when we also know the target language. This call is a
        # cheap "yes, I'm ready to be asked" probe.
        return

    def unload(self) -> None:
        self._pipeline = None
        self._pipeline_lang = None

    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        voice: str = "af_heart",
        language: str = "en",
        speed: float = 1.0,
    ) -> int:
        # Rebuild the pipeline if the language changed — KPipeline binds the
        # phonemizer at construction time.
        lang_code = LANG_CODE_MAP.get(language, "a")
        if self._pipeline is None or self._pipeline_lang != lang_code:
            self._build_pipeline(lang_code)
        assert self._pipeline is not None
        import numpy as np  # lazy: numpy only needed when we actually synthesize

        audio_chunks = []
        for _gs, _ps, audio in self._pipeline(text, voice=voice, speed=speed):
            audio_chunks.append(audio)
        if not audio_chunks:
            raise RuntimeError("kokoro produced no audio")
        audio = np.concatenate(audio_chunks).astype(np.float32)
        pcm = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
        with wave.open(out_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self._sample_rate)
            wf.writeframes(pcm.tobytes())
        return int(len(audio) * 1000 / self._sample_rate)

    def _build_pipeline(self, lang_code: str) -> None:
        # Heavy imports happen here.
        model_path = self._model_path or self._discover_model_path()
        if not model_path or not Path(model_path).exists():
            raise NotReadyError(
                reason="model_path_missing",
                message=f"Kokoro model not found at {model_path}",
                paths=[model_path or ""],
            )
        try:
            from kokoro import KPipeline  # type: ignore

            self._pipeline = KPipeline(lang_code=lang_code, repo_id=str(Path(model_path).parent))
            self._pipeline_lang = lang_code
        except ImportError as exc:
            raise NotReadyError(
                reason="kokoro_not_installed",
                message=f"Install macos/sidecar-env requirements: {exc}",
            ) from exc

    @staticmethod
    def _discover_model_path() -> Optional[str]:
        candidates = [
            Path("models/Kokoro-82M/kokoro-v1_0.pth"),
            Path("../../models/Kokoro-82M/kokoro-v1_0.pth"),
            Path("../models/Kokoro-82M/kokoro-v1_0.pth"),
        ]
        for c in candidates:
            if c.exists():
                return str(c.resolve())
        return None
