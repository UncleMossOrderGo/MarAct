"""Farm order access shared by the owner workspace and a linked LINE account."""

from contextlib import closing
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import HTTPException
from pydantic import BaseModel, Field

from backend.src.modules.marketplace.router import Event, market_connection, transition
from backend.src.shared.db import database_url

from . import router as farm
from .catalog_sync import lot_key


def owned_lots():
    with closing(farm.connect()) as db:
        return [lot_key(farm.farm_id.get(), item) for item in farm.read(db)["listings"]]


def farm_orders(*, order_id=None, decision=None, limit=None):
    keys = owned_lots()
    if not keys:
        if decision:
            raise HTTPException(404, "ไม่พบการจองนี้ในสวนของคุณ")
        return []
    with market_connection(psycopg.connect(database_url(), connect_timeout=3)) as cur:
        cur.execute(
            """SELECT * FROM idea_c_orders o
            WHERE NOT EXISTS (SELECT FROM jsonb_array_elements(o.lines) line
                              WHERE NOT ((line->>'id') = ANY(%s::text[])))
              AND (%s::uuid IS NULL OR id=%s::uuid)
            ORDER BY created DESC LIMIT %s""",
            (keys, order_id, order_id, limit),
        )
        rows = cur.fetchall()
        if decision is None:
            return rows
        if not rows:
            raise HTTPException(404, "ไม่พบการจองนี้ในสวนของคุณ")
        order = rows[0]
        if (
            decision.action == "accept"
            and order["state"] == "accepted"
            and order["payment"] == decision.note
            or decision.action == "reject"
            and order["state"] == "rejected"
            and any(
                x["action"] == "reject" and x["note"] == decision.note
                for x in order["events"]
            )
        ):
            return order
        return transition(cur, order, decision)


def reply_to_order_command(text):
    if text == "ออเดอร์":
        orders = farm_orders(limit=5)
        if not orders:
            return "ยังไม่มีการจองจากผู้ซื้อ"
        return "\n".join(
            f"{o['id']} · {o['buyer']} · ฿{o['total']} · {o['state']}" for o in orders
        ) + ("\nรับออเดอร์ <รหัส> <วิธีชำระเงิน> หรือ ปฏิเสธออเดอร์ <รหัส> <เหตุผล>")
    command, _, args = text.partition(" ")
    if command not in ("รับออเดอร์", "ปฏิเสธออเดอร์"):
        return None
    raw_id, _, note = args.partition(" ")
    try:
        order_id = UUID(raw_id)
    except ValueError:
        return "พิมพ์ ออเดอร์ เพื่อดูรหัสการจองของสวน"
    if not note.strip() or len(note) > 500:
        return "ระบุวิธีชำระเงินหรือเหตุผล 1–500 ตัวอักษร"
    action: Literal["accept", "reject"] = "accept" if command == "รับออเดอร์" else "reject"
    order = farm_orders(order_id=order_id, decision=Event(action=action, note=note))
    return f"อัปเดตการจอง {order['id']} แล้ว · {order['state']}"


@farm.router.get("/orders")
def inbox():
    return farm_orders()


class Decision(BaseModel):
    action: Literal["accept", "reject"]
    note: str = Field(min_length=1, max_length=500)


@farm.router.post("/orders/{order_id}/events")
def decide(order_id: UUID, body: Decision):
    return farm_orders(order_id=order_id, decision=Event(**body.model_dump()))
