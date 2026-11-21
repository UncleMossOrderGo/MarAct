import base64
import hashlib
import hmac
import json
from datetime import timedelta
from uuid import uuid4

import psycopg
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg_pool import ConnectionPool

from backend.src.modules.farmer import line
from backend.src.modules.farmer import router as farm
from backend.src.modules.marketplace import router as market
from backend.src.modules.marketplace.catalog import today
from backend.src.shared.db import database_url


def test_signed_publish_reserve_and_farm_accept(tmp_path, monkeypatch):
    monkeypatch.setattr(farm, "ROOT", tmp_path)
    monkeypatch.setenv("LINE_CHANNEL_SECRET", "local-test")
    monkeypatch.setenv("MARACT_FARM_DELIVERY", "{}")
    buyer_name = uuid4().hex
    owner_id = "owner-" + buyer_name
    farm_root = "/api/farmer"
    buyer_root = "/api/ideas/idea-c"
    app = FastAPI()
    app.include_router(farm.router, prefix=farm_root)
    app.include_router(line.public, prefix=farm_root)
    app.include_router(market.router, prefix=buyer_root)
    replies = []
    monkeypatch.setattr(line, "send_reply", lambda _, message: replies.append(message))

    def deliver(event):
        raw = json.dumps({"events": [event]}).encode()
        signature = base64.b64encode(
            hmac.digest(b"local-test", raw, hashlib.sha256)
        ).decode()
        assert owner.post(
            farm_root + "/line/webhook",
            content=raw,
            headers={"X-Line-Signature": signature},
        ).is_success
        assert line.process_one()
        return replies[-1]

    def text(message, uid=owner_id):
        return deliver(
            {
                "type": "message",
                "webhookEventId": uuid4().hex,
                "replyToken": "local",
                "source": {"type": "user", "userId": uid},
                "message": {"type": "text", "text": message},
            }
        )

    market_id = None
    try:
        with (
            ConnectionPool(database_url()) as pool,
            TestClient(app) as owner,
            TestClient(app) as buyer,
        ):
            app.state.pool = pool
            state = owner.get(farm_root + "/workspace").json()
            text(owner.post(farm_root + "/line/pair").json()["message"])
            name = "มะม่วง" + buyer_name
            arrival = str(today() + timedelta(days=2))
            fields = {
                "fruit": name,
                "stock_kg": 20,
                "price": 50,
                "unit": "กก.",
                "min_kg": 3,
                "ready": str(today()),
                "area": "กรุงเทพฯ",
            }
            assert owner.put(
                farm_root + "/draft",
                json={"revision": state["revision"], "fields": fields},
            ).is_success
            confirm = text("สรุปร่าง")["quickReply"]["items"][0]["action"]["data"]
            filters = {"q": name, "kg": 5, "postcode": "10100", "arrival": arrival}
            assert buyer.get(buyer_root + "/lots", params=filters).json() == []
            deliver(
                {
                    "type": "postback",
                    "webhookEventId": uuid4().hex,
                    "replyToken": "local",
                    "source": {"type": "user", "userId": owner_id},
                    "postback": {"data": confirm},
                }
            )
            assert buyer.get(buyer_root + "/lots", params=filters).json() == []
            monkeypatch.setenv(
                "MARACT_FARM_DELIVERY",
                json.dumps(
                    {
                        "กรุงเทพฯ": {
                            "postcodes": ["10"],
                            "transit": 1,
                            "freight": 60,
                            "window_days": 7,
                        }
                    }
                ),
            )
            (lot,) = buyer.get(buyer_root + "/lots", params=filters).json()
            market_id = lot["id"]
            assert not lot["misses"] and lot["units"] == 5 and lot["total"] == 310
            assert buyer.post(
                buyer_root + "/session",
                json={"name": buyer_name, "password": buyer_name, "register": True},
            ).is_success
            basket = {
                "lines": [{"id": market_id, "units": 5, "requested_kg": 5}],
                "arrival": arrival,
                "postcode": "10100",
            }
            quote = buyer.post(buyer_root + "/quote", json=basket).json()
            order = buyer.post(
                buyer_root + "/orders",
                json={
                    **basket,
                    "id": str(uuid4()),
                    "address": "Test café",
                    "expected": quote,
                },
            ).json()
            assert order["state"] == "pending"
            state = owner.get(farm_root + "/workspace").json()
            listing = state["listings"][0]
            assert owner.put(
                farm_root + "/listings/" + listing["id"] + "/terms",
                json={"revision": state["revision"], "kg": 20, "price": 55},
            ).is_success
            (lot,) = buyer.get(buyer_root + "/lots", params=filters).json()
            assert (lot["stock"], lot["price"]) == (15, 55)
            assert order["id"] in text("ออเดอร์")["text"]
            text("เปิดสวน สวนอื่น", uid="someone-else")
            assert order["id"] not in text("ออเดอร์", uid="someone-else")["text"]
            assert (
                "accepted" in text("รับออเดอร์ " + order["id"] + " จ่ายเมื่อรับสินค้า")["text"]
            )
            (saved,) = buyer.get(buyer_root + "/orders").json()["orders"]
            assert saved["state"] == "accepted" and saved["total"] == 310
            assert name in text("สต็อก")["text"]
            verify = text("ของหมด 1")["quickReply"]["items"][0]["action"]["data"]
            assert (
                buyer.get(buyer_root + "/lots", params=filters).json()[0]["stock"] == 15
            )
            deliver(
                {
                    "type": "postback",
                    "webhookEventId": uuid4().hex,
                    "replyToken": "local",
                    "source": {"type": "user", "userId": owner_id},
                    "postback": {"data": verify},
                }
            )
            (exhausted,) = buyer.get(buyer_root + "/lots", params=filters).json()
            assert exhausted["stock"] == 0 and exhausted["misses"]
            assert buyer.post(buyer_root + "/quote", json=basket).status_code == 409
            assert buyer.get(buyer_root + "/orders").json()["orders"][0]["total"] == 310
    finally:
        with psycopg.connect(database_url()) as db:
            db.execute("DELETE FROM idea_c_orders WHERE buyer=%s", (buyer_name,))
            db.execute("DELETE FROM idea_c_sessions WHERE buyer=%s", (buyer_name,))
            db.execute("DELETE FROM idea_c_buyers WHERE name=%s", (buyer_name,))
            db.execute(
                "DELETE FROM market_farm_listing_sync WHERE lot_id=%s", (market_id,)
            )
            db.execute("DELETE FROM idea_c_lots WHERE id=%s", (market_id,))
