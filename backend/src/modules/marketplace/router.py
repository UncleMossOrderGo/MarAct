import hashlib
import hmac
import os
import secrets
from contextlib import contextmanager
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from backend.src.modules.marketplace.catalog import (
    Basket,
    Postcode,
    Short,
    quote,
    search_lots,
)

router = APIRouter()


def release(cur, order):
    for line in order["lines"]:
        cur.execute(
            "UPDATE idea_c_lots SET stock=stock+%s WHERE id=%s",
            (line["units"], line["id"]),
        )


@contextmanager
def market(req):
    with (
        req.app.state.pool.connection() as conn,
        conn.cursor(row_factory=dict_row) as cur,
    ):
        # One transaction lock keeps expiry, stock changes and retries atomic for the demo.
        cur.execute("SELECT pg_advisory_xact_lock(2026112103)")
        cur.execute("""UPDATE idea_c_orders SET state='expired'
                       WHERE state='pending' AND expires<=clock_timestamp() RETURNING lines""")
        for order in cur.fetchall():
            release(cur, order)
        yield cur


def buyer(cur, req):
    digest = hashlib.sha256(req.cookies.get("market_session", "").encode()).hexdigest()
    cur.execute(
        "SELECT buyer FROM idea_c_sessions WHERE digest=%s AND expires>now()", (digest,)
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(401, "กรุณาเข้าสู่ระบบ")
    return row["buyer"]


class Account(BaseModel):
    name: Short
    password: Annotated[str, Field(min_length=8, max_length=128)]
    create_account: bool = Field(default=False, alias="register")


@router.post("/session")
def session(body: Account, req: Request, response: Response):
    with market(req) as cur:
        cur.execute("SELECT * FROM idea_c_buyers WHERE name=%s", (body.name,))
        row = cur.fetchone()
        salt = secrets.token_bytes(16) if not row else bytes(row["salt"])
        digest = hashlib.scrypt(body.password.encode(), salt=salt, n=16384, r=8, p=1)
        if body.create_account and not row:
            cur.execute(
                "INSERT INTO idea_c_buyers VALUES (%s,%s,%s)", (body.name, salt, digest)
            )
        elif (
            body.create_account
            or not row
            or not hmac.compare_digest(bytes(row["digest"]), digest)
        ):
            raise HTTPException(403, "ชื่อร้านหรือรหัสผ่านไม่ถูกต้อง หรือชื่อร้านนี้มีผู้ใช้แล้ว")
        token = secrets.token_urlsafe(32)
        cur.execute(
            "INSERT INTO idea_c_sessions VALUES (%s,%s,now()+interval '1 day')",
            (hashlib.sha256(token.encode()).hexdigest(), body.name),
        )
        response.set_cookie(
            "market_session",
            token,
            httponly=True,
            samesite="strict",
            secure=req.url.scheme == "https" or os.getenv("MARACT_PUBLIC_DEMO") == "1",
            max_age=86400,
            path="/api/ideas/idea-c",
        )
        return {"buyer": body.name}


@router.post("/logout")
def logout(req: Request, response: Response):
    digest = hashlib.sha256(req.cookies.get("market_session", "").encode()).hexdigest()
    with market(req) as cur:
        cur.execute("DELETE FROM idea_c_sessions WHERE digest=%s", (digest,))
    response.delete_cookie("market_session", path="/api/ideas/idea-c")
    return {"ok": True}


class Trend(BaseModel):
    score: Annotated[int, Field(ge=0, le=100)]


@router.put("/lots/{lot_id}/trend")
def trend(lot_id: Short, body: Trend, req: Request):
    partner(req, "__trend__")
    with market(req) as cur:
        cur.execute("UPDATE idea_c_lots SET trend=%s WHERE id=%s", (body.score, lot_id))
        if cur.rowcount != 1:
            raise HTTPException(404)
    return {"id": lot_id}


@router.get("/lots")
def lots(
    req: Request,
    q: str = "",
    kg: Annotated[int, Field(ge=1, le=1000000)] | None = None,
    postcode: Postcode | None = None,
    arrival: date | None = None,
    sort: Literal["match", "cost", "date"] = "match",
    preference: str = "",
):
    with market(req) as cur:
        return search_lots(cur, q=q, kg=kg, postcode=postcode, arrival=arrival, sort=sort, preference=preference)


@router.post("/quote")
def preview(body: Basket, req: Request):
    with market(req) as cur:
        return quote(cur, body)


class Checkout(Basket):
    id: UUID
    address: Short
    expected: dict


@router.post("/orders")
def checkout(body: Checkout, req: Request):
    with market(req) as cur:
        owner = buyer(cur, req)
        cur.execute("SELECT * FROM idea_c_orders WHERE id=%s", (body.id,))
        existing = cur.fetchone()
        if existing:
            if (
                existing["buyer"] == owner
                and existing["address"] == body.address
                and existing["postcode"] == body.postcode
                and existing["arrival"] == body.arrival
                and [
                    (i["id"], i["units"], i.get("requested_kg"))
                    for i in existing["lines"]
                ]
                == [(p.id, p.units, p.requested_kg) for p in body.lines]
                and all(
                    body.expected.get(k) == existing[k]
                    for k in ("lines", "total", "freight", "farm")
                )
            ):
                return existing
            raise HTTPException(409, "รหัสคำสั่งซื้อซ้ำ")
        offer = quote(cur, body)
        if offer != body.expected:
            raise HTTPException(409, "รายละเอียดเปลี่ยน กรุณาตรวจยอดใหม่")
        for line in body.lines:
            cur.execute(
                "UPDATE idea_c_lots SET stock=stock-%s WHERE id=%s",
                (line.units, line.id),
            )
        cur.execute(
            """INSERT INTO idea_c_orders(id,buyer,farm,address,postcode,arrival,lines,freight,total)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (
                body.id,
                owner,
                offer["farm"],
                body.address,
                body.postcode,
                body.arrival,
                Jsonb(offer["lines"]),
                offer["freight"],
                offer["total"],
            ),
        )
        return cur.fetchone()


class Listing(BaseModel):
    farm: Short
    name: Short
    uses: Short
    grade: Short | None = None
    unit: Short
    kg: Annotated[float, Field(gt=0, le=10000)] | None = None
    price: Annotated[int, Field(gt=0, le=1000000)]
    minimum: Annotated[int, Field(gt=0, le=1000000)]
    stock: Annotated[int, Field(ge=0, le=1000000)]
    starts: date
    ends: date
    transit: Annotated[int, Field(ge=0, le=90)]
    postcodes: Annotated[
        list[Annotated[str, Field(pattern=r"^[0-9]{2,5}$")]], Field(min_length=1)
    ]
    freight: Annotated[int, Field(ge=0, le=1000000)]


@router.put("/lots/{lot_id}")
def publish(
    lot_id: Short, body: Listing, req: Request, previous_version: int | None = None
):
    partner(req, body.farm)
    if body.ends < body.starts or body.farm.startswith("__"):
        raise HTTPException(422)
    fields = tuple(Listing.model_fields)
    with market(req) as cur:
        cur.execute(
            "SELECT farm,version,unit,kg FROM idea_c_lots WHERE id=%s FOR UPDATE",
            (lot_id,),
        )
        row = cur.fetchone()
        if (
            row and (row["farm"] != body.farm or previous_version != row["version"])
        ) or (not row and previous_version is not None):
            raise HTTPException(409, "ข้อมูลล็อตเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด")
        if row and (
            row["unit"] != body.unit
            or (float(row["kg"]) if row["kg"] is not None else None) != body.kg
        ):
            raise HTTPException(409, "กรุณาสร้างล็อตใหม่เมื่อเปลี่ยนหน่วยขาย")
        columns = ",".join(fields)
        placeholders = ",".join(["%s"] * (len(fields) + 1))
        updates = ",".join(f"{f}=EXCLUDED.{f}" for f in fields)
        cur.execute(
            f"INSERT INTO idea_c_lots(id,{columns}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates} RETURNING id, version",
            (lot_id, *body.model_dump().values()),
        )
        return cur.fetchone()


@router.get("/partner/orders")
def inbox(farm: Short, req: Request):
    partner(req, farm)
    with market(req) as cur:
        if farm == "__admin__":
            cur.execute(
                "SELECT * FROM idea_c_orders WHERE issue='escalated' ORDER BY created"
            )
        else:
            cur.execute(
                "SELECT * FROM idea_c_orders WHERE farm=%s ORDER BY created DESC",
                (farm,),
            )
        return cur.fetchall()


@router.get("/orders")
def orders(req: Request):
    with market(req) as cur:
        owner = buyer(cur, req)
        cur.execute(
            "SELECT * FROM idea_c_orders WHERE buyer=%s ORDER BY created DESC", (owner,)
        )
        return {"buyer": owner, "orders": cur.fetchall()}


class Event(BaseModel):
    action: Literal[
        "cancel",
        "ask_cancel",
        "accept",
        "reject",
        "ship",
        "receive",
        "approve_cancel",
        "deny_cancel",
        "report",
        "reply",
        "escalate",
        "resolve",
        "refund",
    ]
    note: Annotated[str, Field(max_length=500)] = ""


def partner(req, farm):
    import json

    keys = json.loads(os.getenv("IDEA_C_PARTNER_KEYS", "{}"))
    key = req.headers.get("X-Market-Key", "")
    if not key or not hmac.compare_digest(key.encode(), keys.get(farm, "").encode()):
        raise HTTPException(403, "สิทธิ์การเข้าถึงไม่ถูกต้อง")


@router.post("/orders/{order_id}/events")
def event(order_id: UUID, body: Event, req: Request):
    with market(req) as cur:
        cur.execute("SELECT * FROM idea_c_orders WHERE id=%s", (order_id,))
        order = cur.fetchone()
        if not order:
            raise HTTPException(404)
        a, state = body.action, order["state"]
        if a in ("cancel", "ask_cancel", "receive", "report", "escalate"):
            if buyer(cur, req) != order["buyer"]:
                raise HTTPException(404)
        else:
            partner(req, "__admin__" if a == "resolve" else order["farm"])
        transitions = {
            ("pending", "cancel"): "cancelled",
            ("pending", "accept"): "accepted",
            ("pending", "reject"): "rejected",
            ("accepted", "ship"): "shipped",
            ("shipped", "receive"): "received",
            ("accepted", "ask_cancel"): "cancel_requested",
            ("cancel_requested", "approve_cancel"): "cancelled",
            ("cancel_requested", "deny_cancel"): "accepted",
        }
        issue, refund, payment = order["issue"], order["refund"], order["payment"]
        if (
            a in ("accept", "reject", "reply", "resolve", "report", "refund")
            and not body.note.strip()
        ):
            raise HTTPException(422, "กรุณาใส่รายละเอียด")
        if (state, a) in transitions:
            if a in ("cancel", "reject", "approve_cancel"):
                release(cur, order)
            if a == "accept":
                payment = body.note
            state = transitions[state, a]
        elif (
            a == "report"
            and issue in ("", "resolved")
            and state not in ("pending", "expired", "rejected")
        ):
            issue = "open"
        elif a == "reply" and issue in ("open", "replied"):
            issue = "replied"
        elif a == "escalate" and issue in ("open", "replied"):
            issue = "escalated"
        elif a == "resolve" and issue == "escalated":
            issue = "resolved"
        elif a == "refund" and (issue or state == "cancelled"):
            refund = body.note
        else:
            raise HTTPException(409, "สถานะคำสั่งซื้อเปลี่ยนแล้ว")
        log = {
            "action": a,
            "note": body.note,
            "at": datetime.now().astimezone().isoformat(),
        }
        cur.execute(
            """UPDATE idea_c_orders SET state=%s,issue=%s,refund=%s,payment=%s, events=events||%s
                       WHERE id=%s RETURNING *""",
            (state, issue, refund, payment, Jsonb([log]), order_id),
        )
        return cur.fetchone()
