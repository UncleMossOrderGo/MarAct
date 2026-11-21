"""Convert a short buyer recording into an editable chat draft."""

import os
from collections.abc import Callable
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from openai import BadRequestError, OpenAI, OpenAIError
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .models import Shop

MAX_BYTES = 4 * 1024 * 1024
FORMATS = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3",
}
Transcribe = Callable[[bytes, str, str], str]


def openai_transcription(data: bytes, mime: str, locale: str) -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Voice transcription is unavailable.")
    model = os.getenv("OPENAI_TRANSCRIPTION_MODEL") or "whisper-1"
    try:
        with OpenAI(api_key=key, timeout=30, max_retries=0) as client:
            file = (f"recording.{FORMATS[mime]}", data, mime)
            if model == "gpt-transcribe":
                result = client.audio.transcriptions.create(
                    file=file, model=model, extra_body={"languages": [locale]},
                )
            else:
                result = client.audio.transcriptions.create(
                    file=file, model=model, language=locale,
                )
    except BadRequestError as exc:
        raise HTTPException(422, "Could not transcribe this recording.") from exc
    except OpenAIError as exc:
        raise HTTPException(503, "Voice transcription is unavailable.") from exc
    return result.text.strip()


def voice_router(engine: Engine, transcribe: Transcribe = openai_transcription) -> APIRouter:
    router = APIRouter()

    def require_shop(shop_id: str) -> None:
        with Session(engine) as session:
            if session.get(Shop, shop_id) is None:
                raise HTTPException(404, "Shop not found.")

    @router.post("/shops/{shop_id}/agent/transcriptions")
    async def transcript(
        shop_id: str, request: Request, locale: Literal["en", "th"] = "th",
    ) -> dict[str, str]:
        mime = request.headers.get("content-type", "").partition(";")[0].strip().lower()
        if mime not in FORMATS:
            raise HTTPException(415, "Unsupported audio recording format.")
        await run_in_threadpool(require_shop, shop_id)
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, "Recording is too large.")
            data.extend(chunk)
        if not data:
            raise HTTPException(422, "The recording is empty.")
        text = await run_in_threadpool(transcribe, bytes(data), mime, locale)
        if not text.strip():
            raise HTTPException(422, "No speech was recognized.")
        return {"text": text.strip()}

    return router
