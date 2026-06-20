"""Lazy TTS sidecar.

Top-level imports stay light on purpose. No torch / kokoro / qwen here —
those are imported inside their engine classes' `load()` methods only.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel


# IMPORTANT: Pydantic body models MUST live at module scope. Defining them
# inside make_app() (a closure) makes FastAPI 0.136 / Pydantic 2.13 fail to
# recognize them as BaseModel subclasses, and the parameter gets reinterpreted
# as a query parameter — every POST then 422s with "field required".
class SynthRequest(BaseModel):
    text: str
    engine: Optional[str] = None
    voice: str = "default"
    cache_key: Optional[str] = None
    cache_subdir: Optional[str] = None
    speed: float = 1.0
    language: str = "en"


class BatchSynthItem(BaseModel):
    text: str
    cache_key: Optional[str] = None


class BatchSynthRequest(BaseModel):
    items: list[BatchSynthItem]
    engine: Optional[str] = None
    voice: str = "default"
    cache_subdir: Optional[str] = None
    speed: float = 1.0
    language: str = "en"

from engine_base import Engine, NotReadyError
from engine_stub import StubEngine

logger = logging.getLogger("tts-sidecar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

IDLE_TIMEOUT_SECONDS = float(os.getenv("TTS_IDLE_TIMEOUT", "60"))


class State:
    def __init__(self, audio_cache: Path, engine_name: str, kokoro_model: Optional[str]) -> None:
        self.audio_cache = audio_cache
        self.engine_name = engine_name
        self.kokoro_model = kokoro_model
        self.engine: Optional[Engine] = None
        self.last_activity = time.monotonic()
        self.jobs: dict[str, dict] = {}

    def touch(self) -> None:
        self.last_activity = time.monotonic()

    def idle_seconds(self) -> float:
        return time.monotonic() - self.last_activity

    def ensure_engine(self) -> Engine:
        if self.engine is not None:
            return self.engine
        eng = build_engine(self.engine_name, self.kokoro_model)
        eng.load()
        self.engine = eng
        return eng

    def unload(self) -> None:
        if self.engine is not None:
            logger.info("unloading engine %s after %.1fs idle", self.engine.name, self.idle_seconds())
            self.engine.unload()
            self.engine = None


def build_engine(name: str, kokoro_model: Optional[str]) -> Engine:
    # Lazy-import the heavy engines so importing this module stays cheap.
    if name == "stub":
        return StubEngine()
    if name == "kokoro":
        try:
            from engine_kokoro import KokoroEngine

            return KokoroEngine(model_path=kokoro_model)
        except Exception as exc:  # noqa: BLE001
            logger.warning("kokoro unavailable (%s), falling back to stub", exc)
            return StubEngine(reason="kokoro_unavailable")
    if name == "qwen":
        try:
            from engine_qwen import QwenEngine

            return QwenEngine()
        except Exception as exc:  # noqa: BLE001
            logger.warning("qwen unavailable (%s), falling back to stub", exc)
            return StubEngine(reason="qwen_unavailable")
    raise ValueError(f"unknown engine: {name}")


def make_app(state: State) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        task = asyncio.create_task(_idle_watchdog(state))
        try:
            yield
        finally:
            task.cancel()
            state.unload()

    app = FastAPI(title="podcast-reader-tts", lifespan=lifespan)

    @app.get("/healthz")
    def healthz():
        # Intentionally cheap — never touches the engine.
        return {"status": "ok"}

    @app.get("/ready")
    def ready():
        return {
            "loaded": state.engine is not None,
            "engine": state.engine.name if state.engine else None,
            "idle_seconds": state.idle_seconds(),
        }

    @app.post("/tts/realtime")
    def synth(req: SynthRequest = Body(...)):
        state.touch()
        # Honor the per-request engine override — this is how the Settings
        # view's engine choice flows down. Swap engines if needed.
        requested = req.engine or state.engine_name
        if state.engine is not None and state.engine.name != requested:
            logger.info("engine swap: %s -> %s", state.engine.name, requested)
            state.unload()
            state.engine_name = requested
        elif state.engine_name != requested:
            state.engine_name = requested
        try:
            engine = state.ensure_engine()
        except NotReadyError as exc:
            return JSONResponse(status_code=503, content={"reason": exc.reason, "message": str(exc), "paths": exc.paths})
        except Exception as exc:
            # Any other engine load error — surface the type + message so the
            # UI can show something more useful than "unknown ()".
            import traceback
            logger.exception("engine load failed")
            return JSONResponse(
                status_code=500,
                content={
                    "reason": f"engine_load_failed:{type(exc).__name__}",
                    "message": str(exc),
                    "traceback": traceback.format_exc().splitlines()[-12:],
                },
            )

        key = req.cache_key or _derive_cache_key(req.text, state.engine_name, req.voice, req.language, req.speed)
        path = _audio_path(state.audio_cache, key, req.cache_subdir)
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists():
            duration = engine.wav_duration_ms(path)
            return {"cache_key": key, "path": str(path), "duration_ms": duration}

        try:
            duration = engine.synthesize(req.text, str(path), voice=req.voice, language=req.language, speed=req.speed)
        except Exception as exc:
            import traceback
            logger.exception("synthesize failed")
            return JSONResponse(
                status_code=500,
                content={
                    "reason": f"synthesize_failed:{type(exc).__name__}",
                    "message": str(exc),
                    "traceback": traceback.format_exc().splitlines()[-12:],
                },
            )
        return {"cache_key": key, "path": str(path), "duration_ms": duration}

    @app.post("/tts/batch")
    def synth_batch(req: BatchSynthRequest = Body(...)):
        state.touch()
        if not req.items:
            return {"items": []}
        requested = req.engine or state.engine_name
        if state.engine is not None and state.engine.name != requested:
            logger.info("engine swap: %s -> %s", state.engine.name, requested)
            state.unload()
            state.engine_name = requested
        elif state.engine_name != requested:
            state.engine_name = requested
        try:
            engine = state.ensure_engine()
        except NotReadyError as exc:
            return JSONResponse(status_code=503, content={"reason": exc.reason, "message": str(exc), "paths": exc.paths})
        except Exception as exc:
            import traceback
            logger.exception("engine load failed")
            return JSONResponse(
                status_code=500,
                content={
                    "reason": f"engine_load_failed:{type(exc).__name__}",
                    "message": str(exc),
                    "traceback": traceback.format_exc().splitlines()[-12:],
                },
            )

        state.audio_cache.mkdir(parents=True, exist_ok=True)
        results: list[dict] = []
        missing_texts: list[str] = []
        missing_paths: list[str] = []
        missing_indexes: list[int] = []
        for item in req.items:
            key = item.cache_key or _derive_cache_key(item.text, state.engine_name, req.voice, req.language, req.speed)
            path = _audio_path(state.audio_cache, key, req.cache_subdir)
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                duration = engine.wav_duration_ms(path)
                results.append({"cache_key": key, "path": str(path), "duration_ms": duration})
            else:
                missing_indexes.append(len(results))
                missing_texts.append(item.text)
                missing_paths.append(str(path))
                results.append({"cache_key": key, "path": str(path), "duration_ms": 0})

        if missing_texts:
            try:
                durations = engine.synthesize_many(
                    missing_texts,
                    missing_paths,
                    voice=req.voice,
                    language=req.language,
                    speed=req.speed,
                )
            except Exception as exc:
                import traceback
                _empty_cuda_cache()
                logger.exception("batch synthesize failed")
                return JSONResponse(
                    status_code=500,
                    content={
                        "reason": f"batch_synthesize_failed:{type(exc).__name__}",
                        "message": str(exc),
                        "traceback": traceback.format_exc().splitlines()[-12:],
                    },
                )
            for result_index, duration in zip(missing_indexes, durations):
                results[result_index]["duration_ms"] = duration
            _empty_cuda_cache()

        return {"items": results}

    def _empty_cuda_cache():
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    @app.post("/tts/jobs")
    def create_job():
        # Realtime is the simple path; jobs are queued on the Rust side and
        # call /tts/realtime per chunk. We keep this endpoint as a future hook.
        raise HTTPException(status_code=501, detail="batch jobs are orchestrated by the Tauri host")

    @app.get("/tts/jobs/{job_id}")
    def get_job(job_id: str):
        if job_id not in state.jobs:
            raise HTTPException(status_code=404, detail="unknown job")
        return state.jobs[job_id]

    @app.post("/tts/jobs/{job_id}/cancel")
    def cancel_job(job_id: str):
        if job_id not in state.jobs:
            raise HTTPException(status_code=404, detail="unknown job")
        state.jobs[job_id]["status"] = "cancelled"
        return {"status": "cancelled"}

    return app


async def _idle_watchdog(state: State) -> None:
    while True:
        await asyncio.sleep(5)
        if state.engine is not None and state.idle_seconds() > IDLE_TIMEOUT_SECONDS:
            state.unload()


def _derive_cache_key(text: str, engine: str, voice: str, language: str, speed: float) -> str:
    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    raw = f"{text_hash}|{engine}|{voice}|{language}|{speed:.2f}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _audio_path(audio_cache: Path, cache_key: str, cache_subdir: Optional[str]) -> Path:
    safe_key = Path(cache_key).name
    if cache_subdir:
        safe_subdir = Path(cache_subdir).name
        if safe_subdir:
            return audio_cache / safe_subdir / f"{safe_key}.wav"
    return audio_cache / f"{safe_key}.wav"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=38219)
    parser.add_argument("--audio-cache", type=Path, required=True)
    parser.add_argument("--engine", default="stub", choices=["stub", "kokoro", "qwen"])
    parser.add_argument("--kokoro-model", type=str, default=None)
    args = parser.parse_args()

    state = State(audio_cache=args.audio_cache, engine_name=args.engine, kokoro_model=args.kokoro_model)
    app = make_app(state)

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
