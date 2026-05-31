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

# Kokoro voice IDs encode the language as a one-letter prefix before the
# gender letter, e.g. `zf_xiaoxiao` = Mandarin Female, `af_heart` = American
# English Female. We trust the voice prefix OVER the `language` field — a
# Chinese voice with a stale `language=en` (the original UI default) must
# still go through the Chinese phonemizer, otherwise espeak's English mode
# verbalizes every codepoint as "Chinese letter, Chinese letter, ..."
VOICE_PREFIX_LANG = {
    "a": "a",  # American English
    "b": "b",  # British English
    "z": "z",  # Mandarin Chinese
    "j": "j",  # Japanese
    "e": "e",  # Spanish
    "f": "f",  # French
    "h": "h",  # Hindi
    "i": "i",  # Italian
    "p": "p",  # Brazilian Portuguese
}


def _resolve_lang_code(voice: str, language: str) -> str:
    """Voice prefix beats the language field. Defaults to American English."""
    if voice and len(voice) >= 2 and voice[1] in {"f", "m"}:
        prefix = voice[0]
        if prefix in VOICE_PREFIX_LANG:
            return VOICE_PREFIX_LANG[prefix]
    return LANG_CODE_MAP.get(language, "a")


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
        lang_code = _resolve_lang_code(voice, language)
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
            from kokoro import KPipeline, KModel  # type: ignore

            # kokoro 0.9+ validates repo_id as a HuggingFace ID and rejects
            # local paths. The correct local-files-only flow is to construct
            # KModel with explicit config + model file paths, then pass the
            # KModel into KPipeline.
            model_dir = Path(model_path).parent
            config_path = model_dir / "config.json"
            if not config_path.exists():
                raise NotReadyError(
                    reason="model_config_missing",
                    message=f"Kokoro config.json not found at {config_path}",
                    paths=[str(config_path)],
                )
            kmodel = KModel(config=str(config_path), model=str(model_path))
            self._pipeline = KPipeline(
                lang_code=lang_code,
                model=kmodel,
                repo_id="hexgrad/Kokoro-82M",   # informational only; model is local
            )
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
