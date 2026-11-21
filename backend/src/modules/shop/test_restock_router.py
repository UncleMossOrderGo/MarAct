from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from .planner import BANGKOK, Fruit, StockItem, StockSnapshot
from .restock_router import restock_router
from .workflow import (
    Dashboard,
    Draft,
    InvalidItems,
    MissingInputs,
    OrderItem,
    Plan,
    PlanItem,
    PlanNotFound,
    StalePlan,
)

PREFIX = "/api/ideas/idea-a"
NOW = datetime(2026, 11, 21, 15, 30, tzinfo=BANGKOK)
DELIVERY = datetime(2026, 11, 22, 9, tzinfo=BANGKOK)


class FakeService:
    fruits = (Fruit("mango", "Mango"), Fruit("banana", "Banana"))

    def __init__(self) -> None:
        self.stock: StockSnapshot | None = None
        self.plan: Plan | None = None
        self.draft: Draft | None = None
        self.saved = 0

    def save_stock(self, items: tuple[StockItem, ...]) -> StockSnapshot:
        if {item.fruit_id for item in items} != {
            fruit.fruit_id for fruit in self.fruits
        }:
            raise InvalidItems("Include each catalog fruit.")
        self.saved += 1
        self.stock = StockSnapshot(NOW, items, "internal-stock-id")
        return self.stock

    def current(self) -> Dashboard:
        return Dashboard(self.fruits, self.stock, self.plan, self.draft)

    def run(self) -> Dashboard:
        if self.stock is None:
            raise MissingInputs(("stock", "usage_history"))
        self.plan = Plan(
            "next",
            DELIVERY.date(),
            DELIVERY,
            NOW.replace(hour=16, minute=0),
            NOW,
            (
                PlanItem(
                    "mango", Decimal(8), Decimal(2), 6, True, False, "Mango is short."
                ),
            ),
        )
        return self.current()

    def confirm(self, plan_id: str, items: tuple[OrderItem, ...]) -> Dashboard:
        if plan_id == "stale":
            raise StalePlan
        if self.plan is None or self.plan.id != plan_id:
            raise PlanNotFound
        if {item.fruit_id for item in items} != {
            fruit.fruit_id for fruit in self.fruits
        }:
            raise InvalidItems("Include each catalog fruit.")
        if self.draft is None:
            self.draft = Draft("saved", NOW, items, "2026-11-22\nMango 5 kg")
        return self.current()


@pytest.fixture
def service() -> FakeService:
    return FakeService()


@pytest.fixture
def client(service: FakeService) -> TestClient:
    app = FastAPI()
    app.include_router(restock_router(service), prefix=PREFIX)
    return TestClient(app)


def test_dashboard_and_missing_inputs(client: TestClient) -> None:
    response = client.get(f"{PREFIX}/plans/current")
    assert response.status_code == 200
    assert response.json() == {
        "fruits": [
            {"fruit_id": "mango", "name": "Mango"},
            {"fruit_id": "banana", "name": "Banana"},
        ],
        "stock": None,
        "plan": None,
        "draft": None,
    }

    response = client.post(f"{PREFIX}/plans/run")
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "missing_inputs",
        "inputs": ["stock", "usage_history"],
    }


@pytest.mark.parametrize(
    "items",
    [
        [{"fruit_id": "mango", "stock_kg": -1, "use_today_kg": 0}],
        [{"fruit_id": "mango", "stock_kg": 1, "use_today_kg": 2}],
        [{"fruit_id": "mango", "stock_kg": "1", "use_today_kg": 0}],
        [{"fruit_id": "papaya", "stock_kg": 1, "use_today_kg": 0}],
        [{"fruit_id": "mango", "stock_kg": 1, "use_today_kg": 0}],
        [{"fruit_id": "mango", "stock_kg": 1, "use_today_kg": 0}] * 2,
    ],
)
def test_invalid_stock_does_not_mutate(
    client: TestClient, service: FakeService, items: list[dict]
) -> None:
    assert client.put(f"{PREFIX}/stock", json={"items": items}).status_code == 422
    assert service.saved == 0


@pytest.mark.parametrize("quantity", [-1, 1.0, 1.5, "1", True])
def test_confirm_rejects_non_whole_kilogram_input(
    client: TestClient, quantity: object
) -> None:
    response = client.post(
        f"{PREFIX}/plans/next/confirm",
        json={"items": [{"fruit_id": "mango", "quantity_kg": quantity}]},
    )
    assert response.status_code == 422


def test_run_confirm_and_return_persisted_retry(client: TestClient) -> None:
    response = client.put(
        f"{PREFIX}/stock",
        json={
            "items": [
                {"fruit_id": "mango", "stock_kg": 10.5, "use_today_kg": 4},
                {"fruit_id": "banana", "stock_kg": 8, "use_today_kg": 0},
            ],
        },
    )
    assert response.status_code == 200
    assert set(response.json()) == {"updated_at", "items"}
    assert response.json()["items"][0]["stock_kg"] == 10.5

    response = client.post(f"{PREFIX}/plans/run")
    assert response.status_code == 200
    assert response.json()["plan"]["items"][0] == {
        "fruit_id": "mango",
        "forecast_kg": 8.0,
        "usable_stock_kg": 2.0,
        "suggested_kg": 6,
        "shortage": True,
        "surplus": False,
        "explanation": "Mango is short.",
    }

    def confirm(plan_id: str, quantity: int):
        return client.post(
            f"{PREFIX}/plans/{plan_id}/confirm",
            json={
                "items": [
                    {"fruit_id": "mango", "quantity_kg": quantity},
                    {"fruit_id": "banana", "quantity_kg": 0},
                ],
            },
        )

    assert confirm("unknown", 5).status_code == 404
    assert confirm("stale", 5).status_code == 409
    first = confirm("next", 5)
    retry = confirm("next", 2)
    assert first.status_code == retry.status_code == 200
    assert first.json()["draft"] == retry.json()["draft"]
    assert retry.json()["draft"]["items"][0]["quantity_kg"] == 5


def test_stock_rejects_value_outside_finite_range(
    client: TestClient, service: FakeService
) -> None:
    response = client.put(
        f"{PREFIX}/stock",
        content='{"items":[{"fruit_id":"mango","stock_kg":1e309,"use_today_kg":0}]}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422
    assert service.saved == 0


@pytest.mark.parametrize(
    "fruits", [("mango",), ("mango", "mango"), ("mango", "unknown")]
)
def test_confirm_invalid_fruit_ids_leave_plan_unconfirmed(
    client: TestClient, service: FakeService, fruits: tuple[str, ...]
) -> None:
    service.save_stock(
        (
            StockItem("mango", Decimal(8), Decimal(3)),
            StockItem("banana", Decimal(8), Decimal(0)),
        )
    )
    service.run()
    response = client.post(
        f"{PREFIX}/plans/next/confirm",
        json={"items": [{"fruit_id": fruit, "quantity_kg": 1} for fruit in fruits]},
    )
    assert response.status_code == 422
    assert service.draft is None
