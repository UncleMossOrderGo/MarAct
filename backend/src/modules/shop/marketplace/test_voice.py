from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from .models import Shop
from .voice import MAX_BYTES, voice_router


def test_transcription_validates_shop_and_recording_before_provider(marketplace_engine: Engine) -> None:
    with Session(marketplace_engine) as session, session.begin():
        session.add(Shop(id="owner", name="Owner", category="bakery", menu_tags=[]))
    calls = []

    def transcribe(data: bytes, mime: str, language: str) -> str:
        calls.append((data, mime, language))
        return " เช็กสต็อกนม "

    app = FastAPI()
    app.include_router(voice_router(marketplace_engine, transcribe))
    client = TestClient(app)
    url = "/shops/owner/agent/transcriptions"
    header = {"content-type": "audio/webm;codecs=opus"}
    assert client.post(url, content=b"").status_code == 415
    assert client.post(url, headers=header, content=b"").status_code == 422
    assert client.post(url, headers=header, content=b"x" * (MAX_BYTES + 1)).status_code == 413
    assert client.post(url.replace("owner", "unknown"), headers=header, content=b"x").status_code == 404
    assert client.post(url + "?locale=zz", headers=header, content=b"x").status_code == 422
    assert not calls
    assert client.post(url + "?locale=th", headers=header, content=b"clip").json() == {"text": "เช็กสต็อกนม"}
    assert calls == [(b"clip", "audio/webm", "th")]
