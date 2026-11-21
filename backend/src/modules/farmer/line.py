"""Signed LINE ingress and account linking for the farmer workspace."""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from contextvars import ContextVar
from urllib.error import HTTPError
from urllib.request import Request as HTTPRequest
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import router as farm
from .domain import REVIEW, draft_summary

public = APIRouter()
logger = logging.getLogger(__name__)
publishing = ContextVar("publishing", default=False)
LIMIT = 4 * 1024 * 1024
HELP = ("ส่ง “เปิดสวน ชื่อสวนของคุณ” เพื่อเริ่มขายที่นี่ หรือถ้ามีสวนบนเว็บแล้ว "
        "เปิด จัดการสวน → เชื่อม LINE แล้วส่งข้อความเชื่อมสวนที่แสดงบนเว็บมาในแชตนี้")


class PairCode(BaseModel):
    code: str = Field(min_length=1, max_length=100)


@farm.router.get("/line/status")
def link_status():
    with closing(farm.connect()) as db:
        linked = db.execute("SELECT 1 FROM line_owner WHERE farm_id=?", (farm.farm_id.get(),)).fetchone()
    return {"linked": bool(linked)}


@farm.router.post("/line/pair")
def pair_code():
    code = secrets.token_urlsafe(12)
    with closing(farm.connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM line_owner WHERE farm_id=?", (farm.farm_id.get(),)).fetchone():
            raise HTTPException(409, "สวนนี้เชื่อม LINE แล้ว")
        db.execute("INSERT OR REPLACE INTO pairing VALUES (?,?,?)", (farm.farm_id.get(), farm.digest(code), int(time.time()) + 600))
    return {"message": "เชื่อมสวน " + code, "expiresIn": 600}


@public.post("/line/open", dependencies=[Depends(farm.require_local_demo)])
def open_linked_farm(body: PairCode, request: Request, response: Response):
    with closing(farm.connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT farm_id FROM browser_pair WHERE code=? AND expires>?", (farm.digest(body.code.strip()), time.time())).fetchone()
        if not row:
            raise HTTPException(422, "รหัสไม่ถูกต้องหรือหมดอายุ พิมพ์ เชื่อมเว็บ ใน LINE เพื่อรับรหัสใหม่")
        farm.start_session(db, row[0], request, response)
        db.execute("DELETE FROM browser_pair WHERE farm_id=?", row)
    return {"linked": True}


@farm.router.delete("/line/link")
def unlink():
    with closing(farm.connect()) as db, db:
        for table in ("line_owner", "pairing", "browser_pair"):
            db.execute(f"DELETE FROM {table} WHERE farm_id=?", (farm.farm_id.get(),))
    return {"linked": False}


def message(text):
    return {"type": "text", "text": text}


def result_message(state, *, chat_reply=False):
    if publishing.get():
        item = state["listings"][0]
        return message(f"ลงขาย{item['fields']['fruit']}บนโปรไฟล์ {state['profile']['name']} และในตลาดผลไม้แล้วครับ")
    draft = state["draft"]
    question = draft["question"] or next(iter(farm.view(state)["missing"]), "")
    if chat_reply:
        latest = draft["history"][-1]
        reply = message(latest["text"])
        offer_publish = latest.get("review", False)
    else:
        reply = message("\n".join([f"ร่างของ{state['profile']['name']}", draft_summary(draft), question or REVIEW]))
        offer_publish = True
    if offer_publish and not question:
        reply["quickReply"] = {"items": [{"type": "action", "action": {"type": "postback",
            "label": "ยืนยันลงขาย", "data": f"publish:{draft['id']}:{state['revision']}"}}]}
    return reply


def saved(db, event_id, reply):
    db.execute("UPDATE line_inbox SET response=? WHERE id=?", (json.dumps(reply), event_id))
    return reply


def account(uid, text, event_id):
    """Change a binding and record its reply in one transaction."""
    with closing(farm.connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        bound = db.execute("SELECT farm_id FROM line_owner WHERE uid=?", (uid,)).fetchone()
        if text.startswith("เชื่อมสวน "):
            if bound:
                return saved(db, event_id, message("บัญชีนี้เชื่อมสวนแล้ว พิมพ์ สรุปร่าง เพื่อดูประกาศ"))
            row = db.execute("SELECT farm_id FROM pairing WHERE code=? AND expires>?", (farm.digest(text.split(maxsplit=1)[1]), time.time())).fetchone()
            if not row:
                return saved(db, event_id, message("รหัสไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่ที่หน้าจัดการสวน"))
            farm_key = row[0]
        elif text.startswith("เปิดสวน ") and not bound:
            name = text.split(maxsplit=1)[1].strip()
            if not 1 <= len(name) <= 200:
                return saved(db, event_id, message("พิมพ์ เปิดสวน ตามด้วยชื่อสวนไม่เกิน 200 ตัวอักษรครับ"))
            farm_key = farm.new_farm(db, name)
        elif not bound:
            return saved(db, event_id, message(HELP))
        elif text == "เชื่อมเว็บ":
            code = secrets.token_urlsafe(12)
            db.execute("INSERT OR REPLACE INTO browser_pair VALUES (?,?,?)", (bound[0], farm.digest(code), int(time.time()) + 600))
            return saved(db, event_id, message("เปิด จัดการสวน → เปิดสวนที่สร้างใน LINE แล้วกรอกรหัสนี้ภายใน 10 นาที เก็บรหัสนี้ไว้ใช้เอง\n" + code))
        else:
            return bound[0]
        db.execute("INSERT INTO line_owner VALUES (?,?)", (uid, farm_key))
        db.execute("DELETE FROM pairing WHERE farm_id=?", (farm_key,))
        return saved(db, event_id, message("เชื่อมสวนแล้วครับ วันนี้จะขายผลไม้อะไร ส่งรายละเอียดหรือรูปมาได้เลย"))


def line_request(url, body=None):
    token = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("LINE token unavailable")
    request = HTTPRequest(url, data=body, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urlopen(request, timeout=8) as response:
        return response.read(LIMIT + 1)


def image_content(message_id):
    if not re.fullmatch(r"[0-9]{1,40}", message_id):
        raise HTTPException(422, "อ่านรูปไม่ได้ กรุณาส่งรูปอีกครั้ง")
    try:
        data = line_request("https://api-data.line.me/v2/bot/message/" + message_id + "/content")
    except HTTPError as exc:
        if exc.code in (404, 410):
            raise HTTPException(422, "รูปนี้หมดอายุแล้ว กรุณาส่งรูปอีกครั้ง") from None
        raise
    if len(data) > LIMIT:
        raise HTTPException(422, "รูปใหญ่เกิน 4 MB กรุณาย่อรูปแล้วส่งอีกครั้ง")
    return base64.b64encode(data).decode()


def send_reply(token, reply):
    line_request("https://api.line.me/v2/bot/message/reply", json.dumps({"replyToken": token, "messages": [reply]}).encode())


def handle(event):
    uid = farm.digest(event["source"]["userId"])
    msg = event.get("message", {})
    text = str(msg.get("text", "")).strip() if msg.get("type") == "text" else ""
    event_id = event["webhookEventId"]
    identity = account(uid, text, event_id)
    if isinstance(identity, dict):
        return identity
    owner = farm.farm_id.set(identity)
    user = farm.line_user.set(uid)
    marker = farm.line_event.set(event_id)
    try:
        state = farm.workspace()
        revision = state["revision"]
        if event["type"] == "postback":
            action = re.fullmatch(r"publish:([a-f0-9]{32}):(\d{1,16})", str(event.get("postback", {}).get("data", "")))
            if not action or action[1] != state["draft"]["id"] or int(action[2]) != revision:
                reply = result_message(state)
                reply["text"] = "ร่างเปลี่ยนแล้ว กรุณาตรวจร่างล่าสุดอีกครั้ง\n" + reply["text"]
                return reply
            flag = publishing.set(True)
            try:
                return result_message(farm.publish(action[1], farm.Version(revision=revision)))
            finally:
                publishing.reset(flag)
        if msg.get("type") == "image":
            raw = image_content(str(msg.get("id", "")))
            return result_message(farm.photos(farm.Photos(revision=revision, images=[raw])))
        if event["type"] == "follow" or text in ("สรุป", "สรุปร่าง", "ยืนยัน", "ยืนยันลงขาย") or text.startswith("เปิดสวน "):
            return result_message(state)
        if 0 < len(text) <= 2000:
            return result_message(farm.chat(farm.Message(revision=revision, message=text)), chat_reply=True)
        return message("ส่งข้อความไม่เกิน 2,000 ตัวอักษร หรือส่งรูปผลไม้เป็นภาพในแชตได้ครับ")
    except HTTPException as exc:
        return message(str(exc.detail) + (" พิมพ์ สรุปร่าง เพื่อดูร่างล่าสุด" if exc.status_code == 409 else ""))
    finally:
        farm.line_event.reset(marker)
        farm.line_user.reset(user)
        farm.farm_id.reset(owner)


def process_one():
    if not (farm.ROOT / "farm.sqlite").is_file():
        return False
    now = time.time()
    with closing(farm.connect()) as db, db:
        if not db.execute("SELECT 1 FROM line_inbox WHERE status='pending' LIMIT 1").fetchone():
            return False
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT id,payload,response,lease,attempts FROM line_inbox WHERE status='pending' ORDER BY received,rowid LIMIT 1").fetchone()
        if not row or row[3] > now:
            return False
        key, raw, cached, _, attempts = row
        db.execute("UPDATE line_inbox SET lease=?, attempts=attempts+1 WHERE id=?", (now + 65, key))
    try:
        event = json.loads(raw)
        reply = json.loads(cached) if cached else handle(event)
        with closing(farm.connect()) as db, db:
            saved(db, key, reply)
        send_reply(event["replyToken"], reply)
    except (OSError, sqlite3.Error, RuntimeError, ValueError, KeyError, TypeError) as exc:
        # An expired/consumed reply token cannot be retried. Never log tokens or messages.
        terminal = isinstance(exc, HTTPError) and exc.code in (400, 401, 403, 404)
        logger.warning("LINE event processing failed (%s)", type(exc).__name__)
        with closing(farm.connect()) as db, db:
            if attempts < 2 and not terminal:
                db.execute("UPDATE line_inbox SET lease=? WHERE id=?", (time.time() + 2, key))
                return False
            db.execute("UPDATE line_inbox SET status='failed',payload=NULL,response=NULL WHERE id=?", (key,))
        return True
    with closing(farm.connect()) as db, db:
        db.execute("UPDATE line_inbox SET status='done',payload=NULL,response=NULL WHERE id=?", (key,))
    return True


async def worker(wakeup):
    while True:
        wakeup.clear()
        try:
            while await asyncio.to_thread(process_one):
                pass
        except (OSError, sqlite3.Error) as exc:
            logger.error("LINE queue unavailable (%s)", type(exc).__name__)
        try:
            await asyncio.wait_for(wakeup.wait(), timeout=3)
        except TimeoutError:
            pass


@public.post("/line/webhook")
async def webhook(request: Request):
    secret = os.getenv("LINE_CHANNEL_SECRET")
    if not secret:
        raise HTTPException(503, "LINE webhook is not configured")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > 2 * 1024 * 1024:
            raise HTTPException(413, "Webhook payload too large")
        raw.extend(chunk)
    expected = base64.b64encode(hmac.digest(secret.encode(), raw, hashlib.sha256)).decode()
    if not hmac.compare_digest(expected.encode(), request.headers.get("x-line-signature", "").encode()):
        raise HTTPException(401, "Invalid LINE signature")
    try:
        payload = json.loads(raw)
        events = payload["events"]
        if not isinstance(events, list):
            raise TypeError
        with closing(farm.connect()) as db, db:
            for event in events:
                if (event.get("type") not in {"message", "postback", "follow"} or event.get("mode") == "standby"
                        or event.get("source", {}).get("type") != "user" or not event["source"].get("userId")
                        or not event.get("replyToken") or not event.get("webhookEventId")):
                    continue
                if event["type"] in {"message", "postback"} and not isinstance(event.get(event["type"]), dict):
                    raise TypeError
                if not all(isinstance(value, str) for value in (event["source"]["userId"], event["replyToken"], event["webhookEventId"])):
                    raise TypeError
                db.execute("INSERT OR IGNORE INTO line_inbox(id,payload,received) VALUES (?,?,?)",
                           (event["webhookEventId"], json.dumps(event), time.time()))
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(400, "Invalid LINE events") from None
    if wakeup := getattr(request.app.state, "line_wakeup", None):
        wakeup.set()
    return {}
