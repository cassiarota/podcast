"""Base contract for TTS engines.

Real engines must NOT import their heavy dependencies at module scope —
only inside `load()`. This is verified by `tests/test_lazy_imports.py`.
"""

from __future__ import annotations

import abc
import wave
from pathlib import Path
from typing import List, Optional, Sequence


class NotReadyError(RuntimeError):
    """Raised when an engine cannot be made ready (missing CUDA, missing model paths, ...).

    The Rust side surfaces `reason` to the UI so the user gets an actionable
    error instead of a stack trace.
    """

    def __init__(self, reason: str, message: str = "", paths: Optional[List[str]] = None) -> None:
        super().__init__(message or reason)
        self.reason = reason
        self.paths = paths or []


class Engine(abc.ABC):
    name: str = "base"

    @abc.abstractmethod
    def load(self) -> None: ...

    @abc.abstractmethod
    def unload(self) -> None: ...

    @abc.abstractmethod
    def synthesize(
        self,
        text: str,
        out_path: str,
        *,
        voice: str = "default",
        language: str = "en",
        speed: float = 1.0,
    ) -> int:
        """Write a WAV to `out_path` and return its duration in milliseconds."""

    def synthesize_many(
        self,
        texts: Sequence[str],
        out_paths: Sequence[str],
        *,
        voice: str = "default",
        language: str = "en",
        speed: float = 1.0,
    ) -> list[int]:
        """Write one WAV per text and return durations in matching order."""
        return [
            self.synthesize(text, out_path, voice=voice, language=language, speed=speed)
            for text, out_path in zip(texts, out_paths)
        ]

    @staticmethod
    def wav_duration_ms(path: Path | str) -> int:
        with wave.open(str(path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate() or 1
            return int(frames * 1000 / rate)
