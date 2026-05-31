"""Qwen engine — used by Windows.

Requires CUDA. Cannot be verified on macOS — left to the Windows checklist
in `windows/README.md`. Heavy imports (numpy, torch, qwen_tts) happen lazily
inside `load()`/`synthesize()`.
"""

from __future__ import annotations

import wave
from pathlib import Path

from engine_base import Engine, NotReadyError

MODEL_DIR = Path(r"D:\models\Qwen3-TTS-12Hz-1.7B-CustomVoice")
TOKENIZER_DIR = Path(r"D:\models\Qwen3-TTS-Tokenizer-12Hz")
DEFAULT_SAMPLE_RATE = 24000


class QwenEngine(Engine):
    name = "qwen"

    def __init__(self) -> None:
        self._model = None
        self._tokenizer = None
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
            from qwen_tts import QwenTTSModel, QwenTTSTokenizer  # type: ignore
        except ImportError as exc:
            raise NotReadyError(
                reason="qwen_tts_not_installed",
                message="Install qwen-tts in the Windows sidecar venv.",
            ) from exc

        self._tokenizer = QwenTTSTokenizer.from_pretrained(str(TOKENIZER_DIR))
        self._model = QwenTTSModel.from_pretrained(str(MODEL_DIR)).to("cuda").eval()

    def unload(self) -> None:
        self._model = None
        self._tokenizer = None

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
        assert self._tokenizer is not None
        import numpy as np  # lazy: numpy only needed when we actually synthesize

        tokens = self._tokenizer.encode(text, language=language, voice=voice)
        # The exact synth API depends on the installed qwen-tts version.
        # We codify the contract here; the Windows verification step is the
        # final source of truth (see windows/README.md).
        audio = self._model.synthesize(tokens, speed=speed)
        if hasattr(audio, "cpu"):
            audio = audio.cpu().numpy()
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        pcm = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
        with wave.open(out_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self._sample_rate)
            wf.writeframes(pcm.tobytes())
        return int(len(audio) * 1000 / self._sample_rate)
