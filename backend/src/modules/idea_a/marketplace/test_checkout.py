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
