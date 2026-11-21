import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.idea_c.router import today
from backend.src.modules.marketplace import copilot
from backend.src.shared.db import database_url

ROOT = "/api/ideas/idea-c"


def test_copilot_uses_catalog_quotes_and_never_orders(shop, monkeypatch):
    client, key, _ = shop
    monkeypatch.setenv("MARACT_PUBLIC_DEMO", "1")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    delivery = {"postcode": "10100", "arrival": str(today() + timedelta(days=2))}
    endpoint = ROOT + "/copilot/chat"
    cart = client.post(endpoint, json={"message": f"จัดตะกร้า {key} 20 กก. งบ 960", **delivery}).json()
    (group,) = cart["groups"]
    assert group["lines"][0]["units"] == 4
    assert group["total"] == basket(client, key)["expected"]["total"] == 1060
    assert cart["delivery_confirmed"]
    assert client.get(ROOT + "/orders").json()["orders"] == []

    under_budget = client.post(endpoint, json={"message": f"จัดตะกร้า {key} 20 กก. งบ 959", **delivery}).json()
    assert under_budget["groups"] == [] and under_budget["unfulfilled"] == [key]
    unknown = client.post(endpoint, json={"message": "แนวโน้มของแอปเปิลสีฟ้า"}).json()
    assert unknown["message"] == copilot.UNKNOWN and unknown["trends"] == []


def test_copilot_trends_match_market_lots(shop, monkeypatch):
    client, key, _ = shop
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    browser_lot(key + "-trend", name="มะม่วงตลาดทดสอบ")
    try:
        result = client.post(ROOT + "/copilot/chat", json={"message": "แนวโน้มมะม่วง"}).json()
        (trend,) = result["trends"]
        assert key + "-trend" in trend["matching_listing_ids"]
        assert trend["signal_type"] == "search_interest"
        assert "เดโม" in trend["caveat"]
    finally:
        cleanup(key + "-trend")


def test_demo_quotas_gate_model_by_session_and_buyer(shop, monkeypatch):
    client, key, _ = shop
    monkeypatch.setenv("MARACT_PUBLIC_DEMO", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setenv("OPENAI_MODEL", "test")
    monkeypatch.setenv("MARACT_AI_BUYER_PER_DAY", "1")
    monkeypatch.setenv("MARACT_AI_IP_PER_MINUTE", "100000")
    monkeypatch.setenv("MARACT_AI_GLOBAL_PER_DAY", "100000")
    calls = []

    def use_tool(payload, timeout):
        calls.append(payload)
        return {"output": [{"type": "function_call", "name": "market_intent", "arguments": json.dumps({
            "action": "search", "items": [{"query": key, "kg": 20}],
        })}]}

    monkeypatch.setattr(copilot, "create_response", use_tool)
    endpoint = ROOT + "/copilot/chat"
    body = {"message": f"หา {key} 20 กก."}
    token = client.cookies.get("market_session")
    client.cookies.clear()
    assert client.post(endpoint, json=body).json()["source"] == "deterministic"
    assert token
    client.cookies.set("market_session", token, path=ROOT)
    first = client.post(endpoint, json=body).json()
    assert first["source"] == "openai" and first["tool_calls"][0]["name"] == "market_intent"
    assert first["lots"][0]["id"] == key
    second = client.post(endpoint, json=body).json()
    assert second["source"] == "deterministic" and second["lots"][0]["id"] == key
    assert len(calls) == 1


@pytest.fixture
def shop(monkeypatch):
    unique = str(uuid4())
    headers = {"X-Market-Key": "fixture-key"}
    monkeypatch.setenv(
        "IDEA_C_PARTNER_KEYS",
        json.dumps({unique: "fixture-key", "__admin__": "admin-key"}),
    )
    with TestClient(app) as client:
        try:
            data = {
                "farm": unique,
                "name": unique,
                "uses": "smoothie",
                "grade": None,
                "unit": "crate",
                "kg": 6,
                "price": 240,
                "minimum": 1,
                "stock": 5,
                "starts": str(today()),
                "ends": str(today() + timedelta(days=10)),
                "transit": 1,
                "postcodes": ["10"],
                "freight": 100,
            }
            assert client.put(
                ROOT + "/lots/" + unique, json=data, headers=headers
            ).is_success
            assert client.post(
                ROOT + "/session",
                json={"name": unique, "password": unique, "register": True},
            ).is_success
            yield client, unique, headers
        finally:
            cleanup(unique)


def browser_lot(
    unique,
    kg=1,
    *,
    name=None,
    farm="สวนริมคลอง",
    grade=None,
    price=48,
    minimum=1,
    freight=0,
):
    with psycopg.connect(database_url()) as db:
        db.execute(
            """INSERT INTO idea_c_lots
            (id,farm,name,uses,unit,kg,price,minimum,stock,starts,ends,transit,postcodes,freight,grade)
            VALUES (%s,%s,%s,'smoothie','crate',%s,%s,%s,30,current_date,
                    current_date+14,1,ARRAY['10'],%s,%s)""",
            (unique, farm, name or unique, kg, price, minimum, freight, grade),
        )


def cleanup(unique):
    with psycopg.connect(database_url()) as db:
        db.execute("DELETE FROM idea_c_orders WHERE buyer=%s", (unique,))
        db.execute("DELETE FROM idea_c_sessions WHERE buyer=%s", (unique,))
        db.execute("DELETE FROM idea_c_buyers WHERE name=%s", (unique,))
        db.execute("DELETE FROM idea_c_lots WHERE id=%s", (unique,))


def basket(client, key):
    body = {
        "lines": [{"id": key, "units": 4}],
        "arrival": str(today() + timedelta(days=2)),
        "postcode": "10100",
    }
    offer = client.post(ROOT + "/quote", json=body).json()
    assert offer["total"] == 1060
    return dict(**body, address="Cafe 123", expected=offer, id=str(uuid4()))


def test_catalog_order_and_stock_race(shop):
    client, key, headers = shop
    row = client.get(
        ROOT + "/lots", params={"q": key, "kg": 20, "postcode": "50100"}
    ).json()[0]
    assert row["units"] == 4 and row["misses"]
    body = basket(client, key)
    stale = dict(body, expected=dict(body["expected"], freight=0))
    assert client.post(ROOT + "/orders", json=stale).status_code == 409
    with ThreadPoolExecutor(2) as workers:
        responses = list(
            workers.map(
                lambda b: client.post(ROOT + "/orders", json=b),
                [body, dict(body, id=str(uuid4()))],
            )
        )
    assert sorted(r.status_code for r in responses) == [200, 409]
    order = next(r.json() for r in responses if r.is_success)
    assert client.post(ROOT + "/orders", json=dict(body, id=order["id"])).is_success
    endpoint = f"{ROOT}/orders/{order['id']}/events"
    assert (
        client.post(endpoint, json={"action": "accept", "note": "transfer"}).status_code
        == 403
    )
    for action in [
        "accept",
        "ask_cancel",
        "deny_cancel",
        "ship",
        "receive",
        "report",
        "reply",
        "escalate",
        "resolve",
        "refund",
    ]:
        h = {"X-Market-Key": "admin-key"} if action == "resolve" else headers
        response = client.post(
            endpoint, json={"action": action, "note": "details"}, headers=h
        )
        assert response.is_success, response.text
    assert response.json()["refund"] == "details"


def test_stale_freight_edit_preserves_new_price(shop):
    client, key, headers = shop

    def read():
        return client.get(ROOT + "/lots", params={"q": key}).json()[0]

    initial = read()
    path = ROOT + "/lots/" + key
    version = {"previous_version": initial["version"]}
    changed = client.put(
        path, params=version, headers=headers, json={**initial, "price": 300}
    )
    assert changed.json()["version"] == initial["version"] + 1
    assert (
        client.put(
            path, params=version, headers=headers, json={**initial, "freight": 120}
        ).status_code
        == 409
    )
    current = read()
    assert (current["price"], current["freight"]) == (300, 100)
    retry = client.put(
        path,
        params={"previous_version": current["version"]},
        headers=headers,
        json={**current, "freight": 120},
    )
    assert retry.is_success
    assert read()["total"] == 420


def test_weight_intent_at_quote_and_checkout(shop):
    client, key, _ = shop
    body = basket(client, key)
    for weight in (6, None):
        with psycopg.connect(database_url()) as db:
            db.execute("UPDATE idea_c_lots SET kg=%s WHERE id=%s", (weight, key))
        lot = client.get(ROOT + "/lots", params={"q": key, "kg": 20}).json()[0]
        assert lot["requested_kg"] == 20
        line = {"id": key, "units": 1, "requested_kg": 20}
        for endpoint in ("/quote", "/orders"):
            response = client.post(ROOT + endpoint, json={**body, "lines": [line]})
            assert response.status_code == 409
            assert ("ไม่ถึงน้ำหนัก" if weight else "ไม่ระบุน้ำหนัก") in response.json()[
                "detail"
            ]
    assert not client.get(ROOT + "/orders").json()["orders"]
    unit_body = {**body, "lines": [{**line, "requested_kg": None}]}
    offer = client.post(ROOT + "/quote", json=unit_body).json()
    assert client.post(
        ROOT + "/orders", json={**unit_body, "expected": offer}
    ).is_success


@pytest.mark.parametrize("end", ["cancel", "expire", "approve_cancel", "reject"])
def test_restores_stock_once(shop, end):
    client, key, headers = shop
    body = basket(client, key)
    assert client.post(ROOT + "/orders", json=body).is_success
    endpoint = f"{ROOT}/orders/{body['id']}/events"
    if end == "expire":
        with psycopg.connect(database_url()) as db:
            db.execute(
                "UPDATE idea_c_orders SET expires=now() WHERE id=%s", (body["id"],)
            )
    else:
        if end == "approve_cancel":
            assert client.post(
                endpoint, json={"action": "accept", "note": "pay"}, headers=headers
            ).is_success
            assert client.post(endpoint, json={"action": "ask_cancel"}).is_success
        assert client.post(
            endpoint, json={"action": end, "note": "reason"}, headers=headers
        ).is_success
    assert client.get(ROOT + "/lots", params={"q": key}).json()[0]["stock"] == 5
    assert (
        client.post(
            endpoint, json={"action": "reject", "note": "retry"}, headers=headers
        ).status_code
        == 409
    )
    assert client.get(ROOT + "/lots", params={"q": key}).json()[0]["stock"] == 5
