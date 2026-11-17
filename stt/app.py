"""HTTP API of the STT service. Internal only: NestJS calls it, the browser
never does (see docker-compose.yml)."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from core import LANGUAGES, NO_SPEECH_MESSAGE, SAMPLE_RATE, Settings, Transcriber

log = logging.getLogger("stt")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

CHUNK = 64 * 1024


def err(status: int, code: str, message: str) -> HTTPException:
    """Errors carry a stable code for the backend and a message for people:
    {"detail": {"code": "no_speech", "message": "Suaramu tidak terdengar…"}}"""
    return HTTPException(status, {"code": code, "message": message})


class Busy:
    """At most `concurrency` transcriptions at once, at most `queue_max`
    waiting; anything beyond that is refused right away (503) so a burst
    can't pile up requests on a 2-vCPU box."""

    def __init__(self, concurrency: int, queue_max: int):
        self.sem = asyncio.Semaphore(concurrency)
        self.queue_max = queue_max
        self.waiting = 0

    async def __aenter__(self):
        if self.sem.locked() and self.waiting >= self.queue_max:
            raise err(503, "busy", "Server sedang sibuk, coba lagi sebentar ya.")
        self.waiting += 1
        try:
            await self.sem.acquire()
        finally:
            self.waiting -= 1
        return self

    async def __aexit__(self, *exc):
        self.sem.release()


def create_app(transcriber: Optional[object] = None, settings: Optional[Settings] = None) -> FastAPI:
    s = settings or Settings.from_env()
    state: dict = {"t": transcriber}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if state["t"] is None:
            started = time.perf_counter()
            log.info("loading model=%s device=%s compute=%s", s.model, s.device, s.compute_type)
            state["t"] = Transcriber(s)  # once, at startup
            log.info("model ready in %.1fs", time.perf_counter() - started)
        yield

    app = FastAPI(title="GoodEnglish STT", lifespan=lifespan)
    busy = Busy(s.concurrency, s.queue_max)

    @app.get("/health")
    async def health():
        return {"ok": state["t"] is not None, "model": s.model}

    @app.post("/api/transcribe")
    async def transcribe(audio: UploadFile = File(...), language: str = Form("en")):
        if language not in LANGUAGES:
            raise err(422, "bad_language", "Bahasa harus en atau id.")
        t = state["t"]
        if t is None:
            raise err(503, "not_ready", "Model belum siap, coba lagi sebentar ya.")

        # Written to a temp file (PyAV needs a seekable file for mp4) and
        # always deleted; the audio is never kept.
        fd, path = tempfile.mkstemp(prefix="stt-", suffix=".audio")
        size = 0
        try:
            with os.fdopen(fd, "wb") as f:
                while chunk := await audio.read(CHUNK):
                    size += len(chunk)
                    if size > s.max_bytes:
                        raise err(413, "too_large", "Rekaman terlalu besar (maksimal 5 MB).")
                    f.write(chunk)
            if size == 0:
                raise err(422, "no_speech", NO_SPEECH_MESSAGE)

            async with busy:
                started = time.perf_counter()
                try:
                    samples = await run_in_threadpool(t.decode, path)
                except Exception:
                    raise err(415, "bad_audio", "Rekaman tidak bisa dibaca, coba rekam lagi ya.")
                duration = len(samples) / SAMPLE_RATE
                if duration > s.max_sec + 0.5:
                    raise err(422, "too_long", "Rekaman terlalu panjang (maksimal 60 detik).")
                text = await run_in_threadpool(t.transcribe, samples, language)
                took = time.perf_counter() - started
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

        # Never the transcript itself: only its shape and the timing.
        log.info(
            "transcribed lang=%s audio=%.1fs took=%.2fs bytes=%d chars=%d",
            language, duration, took, size, len(text),
        )
        if not text:
            raise err(422, "no_speech", NO_SPEECH_MESSAGE)
        return {"text": text, "language": language, "duration_sec": round(duration, 2)}

    return app


# Cheap: the model itself is only loaded at startup (lifespan).
app = create_app()
