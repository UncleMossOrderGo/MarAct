from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from . import models
from .checkout import OrderRepository, orders_router
from .notifications import notification_router, publish_daily_notifications

NOW = datetime(2026, 11, 21, 8, 30, tzinfo=UTC)


@pytest.fixture
def clients(marketplace_engine: Engine):
    with Session(marketplace_engine) as session, session.begin():
        session.add_all(
            [
                models.Shop(id="one", name="Shop One", category="cafe", menu_tags=[]),
                models.Shop(id="two", name="Shop Two", category="cafe", menu_tags=[]),
                models.Fruit(id="mango", name_en="Mango", name_th="มะม่วง", tags=[]),
                models.Seller(
                    id="seller", name="Supplier", area="Bangkok", rating=Decimal("4.5")
                ),
                models.Seller(
                    id="backup", name="Backup", area="Bangkok", rating=Decimal(4)
                ),
            ]
        )
        session.flush()
        session.add_all(
            [
                models.Listing(
                    id="a",
                    fruit_id="mango",
                    seller_id="seller",
                    price_per_kg_thb=Decimal("60.25"),
                    stock_kg=8,
                    active=True,
                ),
                models.Listing(
                    id="z",
                    fruit_id="mango",
                    seller_id="backup",
                    price_per_kg_thb=Decimal(70),
                    stock_kg=4,
                    active=False,
                ),
            ]
        )
    app = FastAPI()
    app.include_router(
        orders_router(OrderRepository(marketplace_engine, clock=lambda: NOW))
    )
    app.include_router(notification_router(marketplace_engine, lambda: NOW))
    with TestClient(app) as client:
        yield client


def checkout_payload(*, shop: str = "one", qty: int = 5, listing: str = "a", key=None):
    return {
        "shop_id": shop,
        "idempotency_key": key or str(uuid4()),
        "items": [{"listing_id": listing, "qty_kg": qty, "price_per_kg_thb": "0.01"}],
    }


def read_stock(engine: Engine) -> int:
    with Session(engine) as session:
        listing = session.scalars(
            select(models.Listing).where(models.Listing.id == "a")
        ).one()
        return listing.stock_kg


def test_checkout_replays_and_reads_captured_order(
    clients: TestClient,
    marketplace_engine: Engine,
):
    payload = checkout_payload()
    created = clients.post("/orders", json=payload)
    assert created.status_code == 201, created.text
    order = created.json()
    assert order["total_thb"] == "301.25"
    assert order["items"] == [
        {
            "listing_id": "a",
            "fruit_id": "mango",
            "fruit_name": "Mango",
            "ingredient_id": "mango",
            "ingredient_name": "Mango",
            "trend_slug": None,
            "trend_label": None,
            "seller_name": "Supplier",
            "qty_kg": 5,
            "price_per_kg_thb": "60.25",
            "line_total_thb": "301.25",
        }
    ]
    assert read_stock(marketplace_engine) == 3

    with Session(marketplace_engine) as session, session.begin():
        listing = session.scalars(
            select(models.Listing).where(models.Listing.id == "a")
        ).one()
        listing.price_per_kg_thb = Decimal(55)
        listing.active = False
        session.add(
            models.TrendRun(
                id="refresh",
                started_at=NOW,
                finished_at=NOW,
                status="ok",
                source="live",
            )
        )
        session.flush()
        session.add(
            models.Trend(
                run_id="refresh",
                fruit_id="mango",
                trend_name="Mango drink",
                rationale="Mango drink appears in Thai menus.",
                related_menus=["Smoothie"],
                confidence=Decimal("0.8"),
                mention_count=1,
                score=Decimal("0.75"),
                sources=[{"url": "https://example.org/mango", "title": "Mango menus"}],
            )
        )

    replay = clients.post(
        "/orders",
        json=checkout_payload(
            key=payload["idempotency_key"],
            qty=500,
            listing="missing",
        ),
    )
    assert replay.status_code == 200
    assert replay.json() == order
    conflict = clients.post(
        "/orders", json=checkout_payload(shop="two", key=payload["idempotency_key"])
    )
    assert conflict.status_code == 409
    assert conflict.json() == {"detail": {"code": "idempotency_key_reused"}}
    assert read_stock(marketplace_engine) == 3
    assert clients.get(f"/orders/{order['id']}").json() == order
    assert clients.get("/shops/one/orders").json() == {"orders": [order]}
    assert clients.get("/shops/two/orders").json() == {"orders": []}
    assert clients.get("/shops/missing/orders").status_code == 404
    assert clients.get("/orders/missing").status_code == 404


@pytest.mark.parametrize("reuse_key", [False, True])
def test_parallel_checkout_decrements_once(
    clients: TestClient,
    marketplace_engine: Engine,
    reuse_key: bool,
):
    barrier = Barrier(2, timeout=5)
    first = checkout_payload()
    second = first if reuse_key else checkout_payload()

    def checkout(payload):
        barrier.wait()
        return clients.post("/orders", json=payload)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(checkout, [first, second]))
    assert sorted(result.status_code for result in results) == (
        [200, 201] if reuse_key else [201, 422]
    )
    if reuse_key:
        assert results[0].json() == results[1].json()
    else:
        failed = next(result for result in results if result.status_code == 422)
        assert failed.json()["detail"] == {
            "code": "insufficient_stock",
            "listing_id": "a",
            "available_kg": 3,
            "requested_kg": 5,
        }
    assert read_stock(marketplace_engine) == 3
    assert len(clients.get("/shops/one/orders").json()["orders"]) == 1


def test_invalid_checkout_and_failure_with_multiple_lines_are_atomic(
    clients: TestClient,
    marketplace_engine: Engine,
):
    invalid_payloads = [
        checkout_payload(key="not-a-uuid"),
        checkout_payload(qty=0),
        checkout_payload(qty=501),
        {**checkout_payload(), "items": []},
    ]
    for qty in (5.0, "5", True):
        payload = checkout_payload()
        payload["items"][0]["qty_kg"] = qty
        invalid_payloads.append(payload)
    duplicate = checkout_payload()
    duplicate["items"] *= 2
    invalid_payloads.append(duplicate)
    for invalid in invalid_payloads:
        assert clients.post("/orders", json=invalid).status_code == 422
    assert (
        clients.post("/orders", json=checkout_payload(shop="missing")).status_code
        == 404
    )

    partial = checkout_payload()
    partial["items"].append({"listing_id": "z", "qty_kg": 1})
    unavailable = clients.post("/orders", json=partial)
    assert unavailable.status_code == 422
    assert unavailable.json()["detail"] == {
        "code": "listing_unavailable",
        "listing_id": "z",
    }
    assert (
        clients.post("/orders", json=checkout_payload(listing="unknown")).status_code
        == 422
    )
    assert read_stock(marketplace_engine) == 8
    assert clients.get("/shops/one/orders").json() == {"orders": []}


def test_shared_listing_combines_stock_and_snapshots_trend_label(
    clients: TestClient,
    marketplace_engine: Engine,
) -> None:
    with Session(marketplace_engine) as session, session.begin():
        session.add(
            models.DailyRun(
                id="daily",
                trend_date=NOW.date(),
                started_at=NOW,
                finished_at=NOW,
                status="ok",
                source="live",
            )
        )
        session.flush()
        session.add(
            models.DailyTrend(
                run_id="daily",
                slug="mango-smoothie",
                name_en="Mango Smoothie",
                name_th="มะม่วง",
                kind="drink",
                momentum="rising",
                is_new=True,
                why_rising_en="Evidence",
                why_rising_th="หลักฐาน",
                score=Decimal("0.8"),
                sources=[],
            )
        )

    payload = checkout_payload(qty=5)
    payload["items"].append(
        {"listing_id": "a", "qty_kg": 4, "trend_slug": "mango-smoothie"}
    )
    response = clients.post("/orders", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"]["requested_kg"] == 9
    assert read_stock(marketplace_engine) == 8

    payload["items"][1]["qty_kg"] = 3
    response = clients.post("/orders", json=payload)
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["total_thb"] == "482.00"
    assert [item["trend_label"] for item in order["items"]] == [None, "Mango Smoothie"]
    assert read_stock(marketplace_engine) == 0

    with Session(marketplace_engine) as session, session.begin():
        run = session.get(models.DailyRun, "daily")
        assert run is not None
        session.delete(run)
    assert clients.get(f"/orders/{order['id']}").json() == order
    assert clients.post("/orders", json=payload).json() == order
    assert read_stock(marketplace_engine) == 0


def test_seeded_gelato_order_uses_server_prices(marketplace_engine: Engine) -> None:
    from typing import cast

    from psycopg import Connection

    from backend.db.seeds.idea_a_marketplace import (
        CHECKOUT_LINES,
        DEFAULT_DAILY_SHOP_ID,
        seed_daily_marketplace,
    )

    with marketplace_engine.begin() as connection:
        seed_daily_marketplace(
            cast(Connection, connection.connection.driver_connection), NOW.date()
        )
    app = FastAPI()
    app.include_router(
        orders_router(OrderRepository(marketplace_engine, clock=lambda: NOW))
    )
    payload = {
        "shop_id": DEFAULT_DAILY_SHOP_ID,
        "idempotency_key": str(uuid4()),
        "items": [
            {"listing_id": listing, "qty_kg": qty, "trend_slug": "pistachio-gelato"}
            for listing, qty in CHECKOUT_LINES
        ],
    }
    with TestClient(app) as client:
        created = client.post("/orders", json=payload)
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["total_thb"] == "5495.00"
        assert {line["trend_label"] for line in body["items"]} == {"Pistachio Gelato"}
        replay = client.post("/orders", json=payload)
        assert replay.status_code == 200
        assert replay.json() == body

    with Session(marketplace_engine) as session:
        assert dict(
            session.execute(
                select(models.Listing.id, models.Listing.stock_kg).where(
                    models.Listing.id.in_([listing for listing, _ in CHECKOUT_LINES])
                )
            ).all()
        ) == {"pistachio-sweeting": 20, "cream-dairypro": 25, "milk-thaidairy": 40}


def test_split_checkout_and_fulfillment_updates_only_the_assigned_order(
    clients: TestClient,
    marketplace_engine: Engine,
) -> None:
    with Session(marketplace_engine) as session, session.begin():
        listing = session.get(models.Listing, "z")
        assert listing is not None
        listing.active = True
    rows = [{"listing_id": "a", "qty_kg": 5}, {"listing_id": "z", "qty_kg": 2}]
    payload = {**checkout_payload(), "items": rows}
    created = clients.post("/orders", json=payload)
    assert created.status_code == 201, created.text
    checkout = created.json()
    assert checkout["total_thb"] == "441.25"
    group_id = checkout["id"]
    assert group_id == checkout["checkout_group_id"]
    children = {order["seller_id"]: order for order in checkout["orders"]}
    assert set(children) == {"backup", "seller"}
    order_id = children["seller"]["id"]
    order_url = f"/orders/{order_id}"
    assert children["seller"]["total_thb"] == "301.25"
    assert children["backup"]["total_thb"] == "140.00"
    assert clients.get("/sellers/seller/orders").json() == {
        "orders": [children["seller"]]
    }
    assert clients.get("/sellers/backup/orders").json() == {
        "orders": [children["backup"]]
    }
    assert (
        clients.post(f"{order_url}/confirm", json={"seller_id": "seller"}).status_code
        == 409
    )
    assert clients.post(f"{order_url}/pay", json={"shop_id": "two"}).status_code == 404
    paid = clients.post(f"{order_url}/pay", json={"shop_id": "one"})
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid"
    assert paid.json()["payment_ref"].startswith("DEMO-")
    assert (
        clients.post(f"{order_url}/pay", json={"shop_id": "one"}).json() == paid.json()
    )
    assert (
        clients.post(f"{order_url}/confirm", json={"seller_id": "backup"}).status_code
        == 404
    )
    confirmed = clients.post(f"{order_url}/confirm", json={"seller_id": "seller"})
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["paid_at"] == "2026-11-21T08:30:00Z"
    assert confirmed.json()["confirmed_at"] == "2026-11-21T08:30:00Z"
    assert (
        clients.post(f"{order_url}/confirm", json={"seller_id": "seller"}).json()
        == confirmed.json()
    )
    assert (
        clients.post(f"{order_url}/pay", json={"shop_id": "one"}).json()
        == confirmed.json()
    )
    replay = clients.post("/orders", json=payload)
    assert replay.status_code == 200
    assert replay.json() == clients.get(f"/orders/{group_id}").json()
    assert clients.get("/shops/one/orders").json() == {"orders": [replay.json()]}
    assert clients.get("/sellers/backup/orders").json() == {
        "orders": [children["backup"]]
    }
    assert read_stock(marketplace_engine) == 3

    seller = {"recipient_type": "seller", "recipient_id": "seller"}
    shop = {"recipient_type": "shop", "recipient_id": "one"}
    seller_inbox = clients.get("/notifications", params=seller).json()
    assert seller_inbox["unread_count"] == 2
    assert {notice["kind"] for notice in seller_inbox["notifications"]} == {
        "order_placed",
        "order_paid",
    }
    shop_inbox = clients.get("/notifications", params=shop).json()
    assert shop_inbox["unread_count"] == 1
    (notice,) = shop_inbox["notifications"]
    assert notice["kind"] == "order_confirmed"
    read_url = f"/notifications/{notice['id']}/read"
    assert clients.post(read_url, json=seller).status_code == 404
    assert clients.post(read_url, json=shop).status_code == 204
    assert clients.get("/notifications", params=shop).json()["unread_count"] == 0
    assert clients.post("/notifications/read-all", json=seller).status_code == 204
    assert clients.get("/notifications", params=seller).json()["unread_count"] == 0


def test_daily_notifications_deduplicate_by_shop_and_date(
    clients: TestClient,
    marketplace_engine: Engine,
) -> None:
    with Session(marketplace_engine) as session, session.begin():
        publish_daily_notifications(
            session, NOW.date(), {"one": "Gelato"}, created_at=NOW
        )
        publish_daily_notifications(
            session, NOW.date(), {"one": "Refresh", "two": "Fruit"}, created_at=NOW
        )
    for shop_id, title in (("one", "Gelato"), ("two", "Fruit")):
        payload = clients.get(
            "/notifications",
            params={"recipient_type": "shop", "recipient_id": shop_id},
        ).json()
        assert payload["unread_count"] == 1
        assert [notice["body"] for notice in payload["notifications"]] == [title]


def test_legacy_order_replays_without_a_new_fulfillment(
    clients: TestClient,
    marketplace_engine: Engine,
) -> None:
    key = str(uuid4())
    with Session(marketplace_engine) as session, session.begin():
        session.add(
            models.Order(
                id="legacy-order",
                shop_id="one",
                idempotency_key=key,
                status="confirmed",
                total_thb=Decimal("60.25"),
                created_at=NOW,
            )
        )
        session.flush()
        session.add(
            models.OrderItem(
                order_id="legacy-order",
                line_index=0,
                listing_id="a",
                fruit_id="mango",
                fruit_name="Mango",
                seller_name="Supplier",
                qty_kg=1,
                price_per_kg_thb=Decimal("60.25"),
                line_total_thb=Decimal("60.25"),
            )
        )
    response = clients.post(
        "/orders",
        json=checkout_payload(key=key, listing="superseded-listing"),
    )
    assert response.status_code == 200
    assert response.json()["id"] == "legacy-order"
    assert response.json()["status"] == "confirmed"
    assert response.json()["total_thb"] == "60.25"
    assert response.json()["checkout_group_id"] is None
    assert (
        clients.post(
            "/orders",
            json=checkout_payload(shop="two", key=key),
        ).status_code
        == 409
    )
    assert read_stock(marketplace_engine) == 8
