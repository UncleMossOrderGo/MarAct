import base64
import hashlib
import hmac
import io
import json
from contextlib import closing
from datetime import date
from threading import Event
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.src.app.main import app
from backend.src.modules.farmer import line
from backend.src.modules.farmer import router as farm
from backend.src.modules.farmer.domain import Fields
from backend.src.modules.farmer.seller_agent import Interpretation

API = "/api/ideas/idea-d"


def signed(client, events):
    raw = json.dumps({"events": events}, ensure_ascii=False).encode()
    sig = base64.b64encode(hmac.digest(b"test-secret", raw, hashlib.sha256)).decode()
    return client.post(API + "/line/webhook", content=raw, headers={"x-line-signature": sig})


def event(text=None, *, image=False, postback=None, uid="line-farmer", key=None):
    result = {"type": "message", "source": {"type": "user", "userId": uid}, "replyToken": "test-only",
              "webhookEventId": key or uuid4().hex, "message": {"type": "text", "text": text}}
    if image:
        result["message"] = {"type": "image", "id": "123456"}
    if postback:
        result.update(type="postback", postback={"data": postback})
        result.pop("message")
    return result


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(farm, "ROOT", tmp_path)
    monkeypatch.setenv("LINE_CHANNEL_SECRET", "test-secret")
    def offline(*args):
        raise AssertionError("Local tests must not contact LINE")
    monkeypatch.setattr(line, "line_request", offline)
    replies = []
    monkeypatch.setattr(line, "send_reply", lambda token, reply: replies.append(reply))
    client = TestClient(app)
    assert client.post(API+"/session", json={"name":"test-grower","password":"test-password","register":True}).is_success
    def deliver(e):
        assert signed(client, [e]).status_code == 200
        assert line.process_one()
        return replies[-1]
    return client, deliver, replies


def test_webhook_signature_empty_and_group(local):
    client, _, replies = local
    assert client.post(API+"/line/webhook", json={"events":[]}).status_code == 401
    assert signed(client, []).status_code == 200
    group = event("เปิดสวน ตัวอย่าง")
    group["source"]["type"] = "group"
    assert signed(client, [group]).status_code == 200
    assert not line.process_one()
    assert not replies


def test_web_line_draft_marketplace_and_retries(local, monkeypatch):
    owner, deliver, replies = local
    other = TestClient(app)
    public = TestClient(app)
    assert other.post(API+"/session", json={"name":"other-grower","password":"test-password","register":True}).is_success
    isolated = other.get(API+"/workspace").json()
    assert not isolated["listings"]
    code = owner.post(API+"/line/pair").json()["message"]
    assert "เชื่อมสวนแล้ว" in deliver(event(code))["text"]
    assert owner.get(API+"/line/status").json()["linked"]
    assert not other.get(API+"/line/status").json()["linked"]
    assert "รหัสไม่ถูกต้อง" in deliver(event(code, uid="other-line"))["text"]

    def interpret(draft, text):
        if text == "มีมะม่วง 30 กิโล":
            return Interpretation(fields=Fields(fruit="มะม่วงทดสอบ", stock_kg=30))
        assert draft["fields"]["stock_kg"] == 30
        return Interpretation(fields=Fields(**{**draft["fields"], "price":42, "unit":"กก.",
                              "ready":date(2026, 11, 25), "area":"กรุงเทพฯ"}))
    monkeypatch.setattr(farm, "interpret", interpret)
    partial = deliver(event("มีมะม่วง 30 กิโล"))
    assert "ราคา" in partial["text"] and "quickReply" not in partial
    png = io.BytesIO()
    Image.new("RGB", (10, 10), "green").save(png, format="PNG")
    def download(url, body=None):
        assert url == "https://api-data.line.me/v2/bot/message/123456/content"
        return png.getvalue()
    monkeypatch.setattr(line, "line_request", download)
    image_event = event(image=True)
    assert "1 รูป" in deliver(image_event)["text"]
    assert signed(owner, [image_event]).is_success
    assert not line.process_one()
    state = owner.get(API+"/workspace").json()
    photo = state["draft"]["photos"][0]
    assert owner.get(API+"/photos/"+photo).is_success
    assert other.get(API+"/photos/"+photo).status_code == 404
    assert public.get(API+"/marketplace/photos/"+photo).status_code == 404
    assert "มะม่วงทดสอบ" not in str(public.get(API+"/marketplace").json())
    ready = deliver(event("42 บาทต่อกิโล ส่งกรุงเทพ วันที่ 25 พ.ย."))
    confirm = ready["quickReply"]["items"][0]["action"]["data"]
    # Owner edits price on the web after the LINE confirmation was generated.
    state = owner.get(API+"/workspace").json()
    assert owner.put(API+"/draft", json={"revision":state["revision"], "fields":{**state["draft"]["fields"], "price":45}}).is_success
    newer = deliver(event(postback=confirm))
    assert "ร่างเปลี่ยนแล้ว" in newer["text"] and "45 บาท" in newer["text"]
    assert "quickReply" in deliver(event("ยืนยันลงขาย"))
    assert "มะม่วงทดสอบ" not in str(public.get(API+"/marketplace").json())
    post = event(postback=newer["quickReply"]["items"][0]["action"]["data"])
    # Simulate losing the first connection to LINE after the publish commit.
    attempts = []
    def fail_once(token, reply):
        attempts.append(reply)
        if len(attempts) == 1:
            raise TimeoutError()
        replies.append(reply)
    monkeypatch.setattr(line, "send_reply", fail_once)
    assert signed(owner, [post]).is_success
    assert not line.process_one()
    with closing(farm.connect()) as db, db:
        db.execute("UPDATE line_inbox SET lease=0 WHERE id=?", (post["webhookEventId"],))
    assert line.process_one()
    assert "ลงขายมะม่วงทดสอบ" in replies[-1]["text"]
    assert attempts[0] == attempts[1]
    assert signed(owner, [post]).is_success and not line.process_one()
    entry = next(entry for entry in public.get(API+"/marketplace").json() if entry["profile"]["name"]=="test-grower")
    assert set(entry) == {"farmId", "profile", "listings"}
    assert sum(lot["fields"]["fruit"] == "มะม่วงทดสอบ" for lot in entry["listings"]) == 1
    assert entry["listings"][0]["fields"]["price"] == 45
    assert public.get(API+"/marketplace/photos/"+photo).headers["content-type"] == "image/jpeg"
    assert not public.cookies
    assert owner.get(API+"/workspace").json()["draft"]["photos"] == []
    assert other.get(API+"/workspace").json() == isolated


def test_line_first_and_browser_recovery(local):
    owner, deliver, _ = local
    assert "เปิดสวน" in deliver(event("สวัสดี"))["text"]
    assert "เชื่อมสวนแล้ว" in deliver(event("เปิดสวน สวนจากไลน์"))["text"]
    code = deliver(event("เชื่อมเว็บ"))["text"].splitlines()[-1]
    assert owner.post(API+"/line/open", json={"code":code}).is_success
    assert owner.get(API+"/workspace").json()["profile"]["name"] == "สวนจากไลน์"
    assert owner.post(API+"/line/open", json={"code":code}).status_code == 422
    another = TestClient(app)
    another.get(API+"/workspace")
    code = deliver(event("เชื่อมเว็บ"))["text"].splitlines()[-1]
    assert another.post(API+"/line/open", json={"code":code}).is_success
    assert another.get(API+"/workspace").json() == owner.get(API+"/workspace").json()
    code = deliver(event("เชื่อมเว็บ"))["text"].splitlines()[-1]
    assert owner.delete(API+"/line/link").is_success
    assert not another.get(API+"/line/status").json()["linked"]
    assert another.post(API+"/line/open", json={"code":code}).status_code == 422
    assert "เปิดสวน" in deliver(event("สรุปร่าง"))["text"]
    pair = owner.post(API+"/line/pair").json()["message"]
    with closing(farm.connect()) as db, db:
        db.execute("UPDATE pairing SET expires=0")
    assert "หมดอายุ" in deliver(event(pair))["text"]


def test_running_worker_resumes_queued_events_and_handles_new_deliveries(local, monkeypatch):
    client, _, _ = local
    # Queue one event while the worker is stopped, as during a restart.
    assert signed(client, [event("เปิดสวน สวนคนปลูก")]).is_success
    replies = []
    received = Event()
    def record_reply(token, reply):
        replies.append(reply["text"])
        received.set()
    monkeypatch.setattr(line, "send_reply", record_reply)
    # The lifespan also starts the independent PostgreSQL pool used by A/B.
    monkeypatch.setattr("backend.src.app.main.ConnectionPool", MagicMock())
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/unused")
    with TestClient(app) as running:
        assert received.wait(5)
        assert "เชื่อมสวนแล้ว" in replies[0]
        received.clear()
        assert signed(running, [event("สรุปร่าง")]).is_success
        assert received.wait(5)
        assert "สวนคนปลูก" in replies[1] and "ผลไม้ที่จะขาย" in replies[1]


def test_line_retries_the_exact_conversational_answer(local, monkeypatch):
    owner, deliver, _ = local
    deliver(event(owner.post(API + "/line/pair").json()["message"]))
    response = "สองลังรวม 640 บาทครับ"
    model = MagicMock(return_value=Interpretation(fields=Fields(), intent="answer", reply=response))
    monkeypatch.setattr(farm, "interpret", model)
    notify = MagicMock(side_effect=[TimeoutError(), None])
    monkeypatch.setattr(line, "send_reply", notify)
    incoming = event("ถ้าสั่งสองลังคิดเป็นกี่บาทครับ")
    assert signed(owner, [incoming]).is_success
    assert not line.process_one()
    with closing(farm.connect()) as db, db:
        db.execute("UPDATE line_inbox SET lease=0 WHERE id=?", (incoming["webhookEventId"],))
    assert line.process_one()
    assert notify.call_args_list[0] == notify.call_args_list[1]
    assert notify.call_args.args[1] == {"type": "text", "text": response}
    assert model.call_count == 1
    draft = owner.get(API + "/workspace").json()["draft"]
    assert draft["history"][-1]["text"] == response
    assert len(draft["history"]) == 2
    notify.side_effect = None
    assert signed(owner, [event("สรุปร่าง")]).is_success
    assert line.process_one()
    assert "ผลไม้ที่จะขาย" in notify.call_args.args[1]["text"]
