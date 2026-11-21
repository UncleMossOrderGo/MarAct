from contextlib import AbstractContextManager, nullcontext
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import cast
from zoneinfo import ZoneInfo

from psycopg import Connection
from pytest import MonkeyPatch

from backend.db import manage
from backend.db.seeds.idea_a import BANGKOK, DEMO_CAFE_ID, seed_demo
from backend.src.modules.idea_a.planner import (
    Fruit,
    StockItem,
    StockSnapshot,
    Usage,
    recommend,
)


class CaptureConnection:
    def __init__(self) -> None:
        self.fruits: dict[tuple, tuple] = {}
        self.usage: dict[tuple, Decimal] = {}
        self.stock: dict[str, tuple] = {}
        self.items: list[tuple] = []
        self.result: tuple | None = None

    def execute(self, sql: str, values: tuple) -> "CaptureConnection":
        sql = " ".join(sql.split())
        self.result = None
        if sql.startswith("INSERT INTO idea_a_fruits"):
            self.fruits.setdefault(values[:2], values[2:])
        elif sql.startswith("INSERT INTO idea_a_usage"):
            self.usage.setdefault(values[:3], values[3])
        elif sql.startswith("INSERT INTO idea_a_stock_snapshots") and not self.stock:
            self.stock[values[0]] = values[1:3]
            self.result = (values[0],)
        elif sql.startswith("INSERT INTO idea_a_stock_items"):
            self.items.append(values)
        else:
            assert "idea_a_" in sql
        return self

    def fetchone(self) -> tuple | None:
        return self.result


def test_seed_builds_demo_with_shortage_surplus_and_unflagged_fruit() -> None:
    day = date(2026, 11, 21)
    db = CaptureConnection()
    seed_demo(cast(Connection, db), day)

    fruits = tuple(
        Fruit(fruit_id, name) for (_, fruit_id), (name, _) in db.fruits.items()
    )
    rows = tuple(
        Usage(fruit_id, usage_date, quantity)
        for (_, fruit_id, usage_date), quantity in db.usage.items()
    )
    assert len(rows) == 21
    assert len({row.quantity_kg for row in rows if row.fruit_id == "mango"}) == 7
    assert {row.day for row in rows} == {day - timedelta(days=n) for n in range(1, 8)}
    _, updated_at = next(iter(db.stock.values()))
    assert updated_at == datetime(2026, 11, 21, tzinfo=BANGKOK)
    snapshot = StockSnapshot(updated_at, tuple(StockItem(*row[1:]) for row in db.items))
    result = recommend(fruits, rows, snapshot, day)
    assert not result.missing
    mango, pineapple, banana = result.items
    assert (mango.forecast_kg, mango.usable_stock_kg, mango.suggested_kg) == (8, 2, 6)
    assert mango.shortage
    assert pineapple.surplus and not pineapple.shortage
    assert not banana.shortage and not banana.surplus


def test_seed_rerun_preserves_previous_usage_and_stock() -> None:
    day = date(2026, 11, 21)
    db = CaptureConnection()
    seed_demo(cast(Connection, db), day)
    changed_usage = (DEMO_CAFE_ID, "mango", day - timedelta(days=1))
    db.usage[changed_usage] = Decimal(9)
    db.stock["latest-user-stock"] = (
        DEMO_CAFE_ID,
        datetime(2026, 11, 21, 15, tzinfo=BANGKOK),
    )

    seed_demo(cast(Connection, db), day)
    assert db.usage[changed_usage] == Decimal(9)
    assert len(db.usage) == 21
    assert len(db.stock) == 2
    assert len(db.items) == 3


def test_cli_selections_reach_demo_seed_only_for_idea_a(
    monkeypatch: MonkeyPatch,
) -> None:
    class SeedConnection:
        def execute(self, sql: str, **kwargs: object) -> "SeedConnection":
            self.sql = sql
            return self

        def fetchone(self) -> tuple[str]:
            assert "to_regclass" in self.sql
            return ("idea_a_cafes",)

        def transaction(self) -> AbstractContextManager[None]:
            return nullcontext()

    class DemoClock:
        @staticmethod
        def now(tz: ZoneInfo) -> datetime:
            assert tz == BANGKOK
            return datetime(2026, 11, 21, 0, 30, tzinfo=tz)

    connection = SeedConnection()
    calls: list[date] = []

    def capture_seed(db: SeedConnection, planning_date: date) -> None:
        assert db is connection
        calls.append(planning_date)

    monkeypatch.setattr(manage, "datetime", DemoClock)
    monkeypatch.setattr(manage, "database_url", lambda: "fake")
    monkeypatch.setattr(
        manage.psycopg, "connect", lambda *args, **kwargs: nullcontext(connection)
    )
    monkeypatch.setattr(manage, "seed_demo", capture_seed)

    manage.seed("idea-b")
    assert not calls
    manage.seed("idea-a")
    manage.seed("--all")
    assert calls == [date(2026, 11, 21)] * 2
