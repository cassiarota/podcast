"""Qwen engine — used by Windows.

Requires CUDA. Cannot be verified on macOS — left to the Windows checklist
in `windows/README.md`. Heavy imports (numpy, torch, qwen_tts) happen lazily
inside `load()`/`synthesize()`.
"""

from __future__ import annotations

import wave
from pathlib import Path
from typing import Sequence

from engine_base import Engine, NotReadyError

MODEL_DIR = Path(r"D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice")
TOKENIZER_DIR = Path(r"D:\models\Qwen3-TTS-Tokenizer-12Hz")
DEFAULT_SAMPLE_RATE = 24000


class QwenEngine(Engine):
    name = "qwen"

    def __init__(self) -> None:
        self._model = None
        self._sample_rate = DEFAULT_SAMPLE_RATE

    def load(self) -> None:
        if self._model is not None:
            return
        try:
            import torch  # type: ignore
        except ImportError as exc:
            raise NotReadyError(
                reason="torch_not_installed",
                message="Install windows/sidecar-env requirements first.",
            ) from exc

        if not torch.cuda.is_available():
            raise NotReadyError(
                reason="cuda_missing",
                message="Qwen requires an NVIDIA CUDA-capable GPU.",
            )

        missing: list[str] = []
        if not MODEL_DIR.exists():
            missing.append(str(MODEL_DIR))
        if not TOKENIZER_DIR.exists():
            missing.append(str(TOKENIZER_DIR))
        if missing:
            raise NotReadyError(
                reason="model_path_missing",
                message="Qwen model directories missing.",
                paths=missing,
            )

        try:
            from qwen_tts import Qwen3TTSModel  # type: ignore
        except ImportError as exc:
            raise NotReadyError(
                reason="qwen_tts_not_installed",
                message="Install qwen-tts in the Windows sidecar venv.",
            ) from exc

        self._model = Qwen3TTSModel.from_pretrained(
            str(MODEL_DIR),
            device_map="cuda:0",
            dtype=torch.bfloat16,
            attn_implementation="sdpa",
        )
        if hasattr(self._model, "model") and hasattr(self._model.model, "eval"):
            self._model.model.eval()

    def unload(self) -> None:
        self._model = None

    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        voice: str = "default",
        language: str = "en",
        speed: float = 1.0,
    ) -> int:
        if self._model is None:
            self.load()
        assert self._model is not None
        import numpy as np  # lazy: numpy only needed when we actually synthesize

        wavs, sample_rate = self._model.generate_custom_voice(
            text=text,
            language=_resolve_language(language),
            speaker=_resolve_speaker(voice, language),
            instruct="",
        )
        self._sample_rate = int(sample_rate or DEFAULT_SAMPLE_RATE)
        audio = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
        return _write_wav(audio, out_path, self._sample_rate)

    def synthesize_many(
        self,
        texts: Sequence[str],
        out_paths: Sequence[str],
        *,
        voice: str = "default",
        language: str = "en",
        speed: float = 1.0,
    ) -> list[int]:
        if len(texts) != len(out_paths):
            raise ValueError("texts and out_paths must have the same length")
        if not texts:
            return []
        if self._model is None:
            self.load()
        assert self._model is not None
        import numpy as np  # lazy

        resolved_language = _resolve_language(language)
        resolved_speaker = _resolve_speaker(voice, language)
        wavs, sample_rate = self._model.generate_custom_voice(
            text=list(texts),
            language=[resolved_language] * len(texts),
            speaker=[resolved_speaker] * len(texts),
            instruct=[""] * len(texts),
        )
        self._sample_rate = int(sample_rate or DEFAULT_SAMPLE_RATE)
        durations: list[int] = []
        for wav, out_path in zip(wavs, out_paths):
            audio = np.asarray(wav, dtype=np.float32).reshape(-1)
            durations.append(_write_wav(audio, out_path, self._sample_rate))
        return durations


def _write_wav(audio, out_path: str, sample_rate: int) -> int:
    import numpy as np

    pcm = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return int(len(audio) * 1000 / sample_rate)


def _resolve_language(language: str) -> str:
    normalized = (language or "en").lower()
    if normalized.startswith("zh"):
        return "Chinese"
    if normalized.startswith("en"):
        return "English"
    return "Auto"


def _resolve_speaker(voice: str, language: str) -> str:
    normalized = (voice or "default").lower()
    supported = {
        "aiden",
        "dylan",
        "eric",
        "ono_anna",
        "ryan",
        "serena",
        "sohee",
        "uncle_fu",
        "vivian",
    }
    if normalized in supported:
        return normalized
    return "vivian" if _resolve_language(language) == "Chinese" else "ryan"
