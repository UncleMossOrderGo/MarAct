"""Farmer workspace and versioned draft operations shared by the web and LINE."""
import base64
import hashlib
import io
import json
import os
import secrets
import sqlite3
from contextlib import closing
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from openai import OpenAIError
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from .domain import REVIEW, Fields, Profile, draft_summary, questions
from .seller_agent import interpret

BACKEND = Path(__file__).resolve().parents[3]
DEFAULT_DATA = BACKEND / ".local" / "farmer"
LEGACY_DATA = Path(__file__).resolve().parents[1] / "idea_d" / ".local"
# Existing installations can keep their store when updating the application.
ROOT = Path(os.getenv("FARMER_DATA_DIR") or os.getenv("IDEA_D_DATA_DIR") or (
    LEGACY_DATA if (LEGACY_DATA / "farm.sqlite").is_file() and not (DEFAULT_DATA / "farm.sqlite").exists() else DEFAULT_DATA
))


def require_local_demo(request: Request) -> None:
    """Owner sessions are provisioned on the local demo host."""
    local_hosts = {"127.0.0.1", "::1", "localhost", "testserver"}
    origin = request.headers.get("origin")
    if request.url.hostname not in local_hosts or (origin and urlsplit(origin).hostname not in local_hosts):
        raise HTTPException(403, "Farmer Studio is currently a local demo")


farm_id: ContextVar[int] = ContextVar("farm_id", default=1)
line_user: ContextVar[str] = ContextVar("line_user", default="")
line_event: ContextVar[str] = ContextVar("line_event", default="")


COOKIE_PATH = "/api/ideas/idea-d"
SESSION_SECONDS = 60 * 60 * 24 * 30


async def owner_session(request: Request):
    cookie = request.cookies.get("maract_farm_owner", "")
    with closing(connect()) as db:
        owner = db.execute("SELECT farm_id FROM owner WHERE session=? AND expires>unixepoch()", (digest(cookie),)).fetchone()
    if not owner:
        raise HTTPException(401, "กรุณาเข้าสู่ระบบสวน")
    marker = farm_id.set(owner[0])
    try:
        yield
    finally:
        farm_id.reset(marker)


def start_session(db, identity, request, response):
    token = secrets.token_urlsafe(32)
    db.execute("DELETE FROM owner WHERE session=? OR expires<=unixepoch()", (digest(request.cookies.get("maract_farm_owner", "")),))
    db.execute("INSERT INTO owner(session,farm_id,expires) VALUES (?,?,unixepoch()+?)", (digest(token), identity, SESSION_SECONDS))
    response.set_cookie("maract_farm_owner", token, httponly=True, samesite="strict",
                        secure=request.url.scheme == "https", max_age=SESSION_SECONDS, path=COOKIE_PATH)


def new_farm(db, name):
    state = initial()
    state.update(profile={"name": name, "area": "", "location": "", "about": ""}, listings=[])
    return db.execute("INSERT INTO farm(state) VALUES (?)", (json.dumps(state),)).lastrowid


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


router = APIRouter(dependencies=[Depends(require_local_demo), Depends(owner_session)])


def blank():
    return {"id": uuid4().hex, "fields": Fields().model_dump(), "photos": [], "cover": 0,
            "history": [], "question": ""}


def initial():
    items = []
    for fruit, photo, price, stock in [
        ("มะม่วงน้ำดอกไม้", "gold", 45, 120), ("มะม่วงเขียวเสวย", "green", 38, 85)
    ]:
        fields = Fields(fruit=fruit, stock_kg=stock, price=price, unit="กก.", min_kg=5,
                        area="กรุงเทพฯ และฉะเชิงเทรา").model_dump(mode="json")
        items.append({"id": photo, "fields": fields, "photos": [photo], "cover": 0, "available": True})
    return {"revision": 0, "profile": {"name": "สวนลุงสม", "location": "ฉะเชิงเทรา",
            "about": "สวนมะม่วงครอบครัว ส่งผลผลิตตามฤดูกาลตรงถึงร้านค้าและผู้ประกอบการ",
            "area": "กรุงเทพฯ และฉะเชิงเทรา"}, "draft": blank(), "listings": items}


def connect():
    ROOT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(ROOT / "farm.sqlite", timeout=10)
    if db.execute("PRAGMA user_version").fetchone()[0] >= 2:
        return db
    db.execute("BEGIN IMMEDIATE")
    db.execute("CREATE TABLE IF NOT EXISTS farm (id INTEGER PRIMARY KEY, state TEXT NOT NULL)")
    db.execute("INSERT OR IGNORE INTO farm VALUES (1, ?)", (json.dumps(initial()),))
    db.execute("CREATE TABLE IF NOT EXISTS owner(session TEXT PRIMARY KEY, farm_id INTEGER NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS pairing(farm_id INTEGER PRIMARY KEY, code TEXT UNIQUE, expires INTEGER)")
    db.execute("CREATE TABLE IF NOT EXISTS line_owner(uid TEXT PRIMARY KEY, farm_id INTEGER UNIQUE NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS browser_pair(farm_id INTEGER PRIMARY KEY, code TEXT UNIQUE, expires INTEGER)")
    db.execute("""CREATE TABLE IF NOT EXISTS line_inbox(
        id TEXT PRIMARY KEY, payload TEXT, status TEXT DEFAULT 'pending', lease REAL DEFAULT 0,
        attempts INTEGER DEFAULT 0, received REAL NOT NULL, response TEXT)""")
    db.execute("CREATE INDEX IF NOT EXISTS line_work ON line_inbox(status, received)")
    if "expires" not in {row[1] for row in db.execute("PRAGMA table_info(owner)")}:
        db.execute("ALTER TABLE owner ADD COLUMN expires INTEGER NOT NULL DEFAULT 0")
        db.execute("UPDATE owner SET expires=unixepoch()+?", (SESSION_SECONDS,))
    db.execute("""CREATE TABLE IF NOT EXISTS farmer_account (
        login TEXT PRIMARY KEY, farm_id INTEGER NOT NULL UNIQUE REFERENCES farm(id), salt BLOB NOT NULL, digest BLOB NOT NULL)""")
    db.execute("PRAGMA user_version=2")
    db.commit()
    return db


def read(db):
    return json.loads(db.execute("SELECT state FROM farm WHERE id=?", (farm_id.get(),)).fetchone()[0])


def view(state):
    fields = Fields(**state["draft"]["fields"])
    return {**state, "farmId": farm_id.get(), "missing": questions(fields)}


def update(revision, change, *, chat_reply=False):
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        if line_user.get() and not db.execute("SELECT 1 FROM line_owner WHERE uid=? AND farm_id=?", (line_user.get(),farm_id.get())).fetchone():
            raise HTTPException(403, "การเชื่อมบัญชีเปลี่ยนแล้ว กรุณาเชื่อมสวนอีกครั้ง")
        state = read(db)
        if state["revision"] != revision:
            raise HTTPException(409, "ข้อมูลเปลี่ยนในอีกหน้าต่าง กรุณาโหลดข้อมูลล่าสุด")
        change(state)
        state["revision"] += 1
        db.execute("UPDATE farm SET state=? WHERE id=?", (json.dumps(state), farm_id.get()))
        if line_event.get():
            # Store the acknowledgement in the same transaction as the state change.
            from .line import result_message
            reply = result_message(state, chat_reply=chat_reply)
            db.execute("UPDATE line_inbox SET response=? WHERE id=?", (json.dumps(reply),line_event.get()))
    return view(state)


class Version(BaseModel):
    revision: int


class FarmEdit(Version):
    profile: Profile


class DraftEdit(Version):
    fields: Fields
    cover: int = Field(ge=0, default=0)


class Message(Version):
    message: str = Field(min_length=1, max_length=2000)


class Photos(Version):
    images: list[str] = Field(min_length=1, max_length=6)


class Stock(Version):
    kg: float = Field(ge=0, le=1e9, allow_inf_nan=False)
    price: float = Field(gt=0, le=1e9, allow_inf_nan=False)


class Cover(Version):
    cover: int = Field(ge=0)


@router.put("/draft/cover")
def cover(body: Cover):
    def save(s):
        draft = s["draft"]
        if body.cover >= len(draft["photos"]):
            raise HTTPException(422, "ไม่พบรูปนี้")
        draft["cover"] = body.cover
    return update(body.revision, save)


@router.get("/workspace")
def workspace():
    with closing(connect()) as db:
        return view(read(db))


@router.get("/catalog")
def catalog():
    with closing(connect()) as db:
        state = read(db)
        return {"profile": state["profile"], "listings": state["listings"]}


@router.put("/profile")
def profile(body: FarmEdit):
    return update(body.revision, lambda s: s.update(profile=body.profile.model_dump()))


@router.put("/draft")
def draft(body: DraftEdit):
    def save(s):
        d = s["draft"]
        if body.cover >= max(1, len(d["photos"])):
            raise HTTPException(422, "ไม่พบรูปปกที่เลือก")
        d.update(fields=body.fields.model_dump(mode="json"), cover=body.cover, question="")
    return update(body.revision, save)


@router.post("/draft/chat")
def chat(body: Message):
    with closing(connect()) as db:
        state = read(db)
    if state["revision"] != body.revision:
        raise HTTPException(409, "กรุณาโหลดร่างล่าสุด")
    try:
        answer = interpret(state["draft"], body.message)
    except (OpenAIError, RuntimeError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "ติดต่อผู้ช่วยไม่ได้ กรุณาลองอีกครั้ง หรือกรอกในแบบฟอร์ม") from None
    def save(s):
        d = s["draft"]
        d["fields"] = answer.fields.model_dump(mode="json")
        d["question"] = answer.question
        reply = answer.reply
        if answer.cover_number is not None:
            if 1 <= answer.cover_number <= len(d["photos"]):
                d["cover"] = answer.cover_number - 1
            else:
                reply = ""
                d["question"] = "ยังไม่มีรูปตามหมายเลขนี้ ต้องการใช้รูปใดครับ?"
        missing = questions(answer.fields)
        follow = d["question"] or next(iter(missing), "")
        review = not follow and answer.intent in ("update", "summary")
        parts = []
        if reply and answer.intent != "summary":
            parts.append(reply)
        if answer.intent == "summary" or review:
            parts.append(draft_summary(d))
        if answer.intent != "answer":
            parts.append(follow or REVIEW)
        d["history"].extend([
            {"role": "user", "text": body.message},
            {"role": "assistant", "text": "\n".join(parts), "review": review},
        ])
    return update(body.revision, save, chat_reply=True)


@router.post("/draft/photos")
def photos(body: Photos):
    def save(s):
        d = s["draft"]
        if len(d["photos"])+len(body.images)>6:
            raise HTTPException(422, "เพิ่มได้สูงสุด 6 รูปต่อประกาศ")
        converted = []
        for raw in body.images:
            try:
                if len(raw) > 5_600_000:
                    raise ValueError()
                with Image.open(io.BytesIO(base64.b64decode(raw, validate=True))) as im:
                    if im.format not in {"JPEG","PNG","WEBP"} or im.width*im.height>20_000_000:
                        raise ValueError()
                    pic = ImageOps.exif_transpose(im).convert("RGB")
                    pic.thumbnail((1400,1400))
                    buf = io.BytesIO()
                    pic.save(buf,"JPEG",quality=86)
                    converted.append(buf.getvalue())
            except (ValueError, OSError, Image.DecompressionBombError, UnidentifiedImageError):
                raise HTTPException(422,"ใช้รูป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB และ 20 ล้านพิกเซล")
        for data in converted:
            key = uuid4().hex
            (ROOT / (key+".jpg")).write_bytes(data)
            d["photos"].append(key)
    return update(body.revision, save)


@router.get("/photos/{key}")
def photo(key: str):
    with closing(connect()) as db:
        state = read(db)
    if not any(key in lot["photos"] for lot in [state["draft"], *state["listings"]]):
        raise HTTPException(404)
    return image_file(key)


def image_file(key: str):
    if len(key)!=32 or any(c not in "0123456789abcdef" for c in key):
        raise HTTPException(404)
    path = ROOT / (key+".jpg")
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path,media_type="image/jpeg",headers={"Cache-Control":"private, no-store"})


@router.post("/draft/{draft_id}/publish")
def publish(draft_id: str, body: Version):
    def save(s):
        d = s["draft"]
        if d["id"] != draft_id:
            raise HTTPException(409, "ร่างนี้ถูกเผยแพร่หรือเปลี่ยนแล้ว")
        if questions(Fields(**d["fields"])) or d["question"]:
            raise HTTPException(422, "กรุณาตรวจข้อมูลที่ยังขาดก่อนลงขาย")
        s["listings"].insert(0,{k:d[k] for k in ("id","fields","photos","cover")} | {"available":True})
        s["draft"] = blank()
    return update(body.revision, save)


@router.put("/listings/{key}/terms")
def stock(key: str, body: Stock):
    def save(s):
        item = next((i for i in s["listings"] if i["id"]==key),None)
        if not item:
            raise HTTPException(404)
        item["fields"]["stock_kg"] = body.kg
        item["fields"]["price"] = body.price
        item["available"] = body.kg > 0
    return update(body.revision, save)
