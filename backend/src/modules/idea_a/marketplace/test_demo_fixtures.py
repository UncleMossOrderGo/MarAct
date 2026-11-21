from contextlib import nullcontext
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import cast

import pytest
from psycopg import Connection
from psycopg.conninfo import make_conninfo
from sqlalchemy.engine import Engine

from backend.db import manage
from backend.db.seeds.idea_a_marketplace import (
    BANGKOK,
    SEED_TREND_RUN_ID,
    seed_marketplace,
)
from backend.src.modules.idea_a.marketplace.catalog import CatalogRepository
from backend.src.modules.idea_a.marketplace.ranking import TrendSignal, rank
from backend.src.shared.db import database_url

DAY = date(2026, 11, 21)


def test_fixture_adapter_writes_seven_local_days_and_sourced_trend() -> None:
    batches: dict[str, list[tuple]] = {}

    class CaptureConnection:
        def cursor(self):
            return nullcontext(self)

        def execute(self, sql: str, row: tuple) -> None:
            self.executemany(sql, [row])

        def executemany(self, sql: str, rows) -> None:
            _, _, table, *_ = sql.split()
            assert table.startswith("idea_a_")
            assert "ON CONFLICT" in sql
            batches[table] = list(rows)

    seed_marketplace(cast(Connection, CaptureConnection()), DAY)
    assert len(batches["idea_a_shops"]) == len(batches["idea_a_sellers"]) == 3
    for shop_id, *_ in batches["idea_a_shops"]:
        assert {row[2] for row in batches["idea_a_usage"] if row[0] == shop_id} == {
            DAY - timedelta(days=offset) for offset in range(1, 8)
        }
    ((run_id, started_at, finished_at),) = batches["idea_a_trend_runs"]
    assert run_id == SEED_TREND_RUN_ID
    assert started_at == finished_at == datetime(2026, 11, 21, tzinfo=BANGKOK)
    (trend,) = batches["idea_a_trends"]
    assert trend[1] == "mango"
    assert trend[-1].obj[0]["url"].startswith("https://")
    assert trend[7] == Decimal("0.59")


def test_seed_dispatch_ranking_and_rerun_after_sale(
    marketplace_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    with marketplace_engine.connect() as db:
        schema = db.exec_driver_sql("SELECT current_schema()").scalar_one()
    monkeypatch.setenv(
        "DATABASE_URL", make_conninfo(database_url(), options=f"-csearch_path={schema}")
    )
    manage.seed("idea-a", planning_date=DAY)

    catalog = CatalogRepository(marketplace_engine)
    smoothie = catalog.shop("demo")
    assert smoothie is not None and smoothie.name == "Smoothie Café"
    with marketplace_engine.connect() as db:
        trend = TrendSignal(
            *db.exec_driver_sql(
                "SELECT fruit_id, score, trend_name FROM idea_a_trends"
            ).one()
        )
    top, *_ = rank(
        smoothie, catalog.usage_totals("demo", DAY), catalog.listings(), [trend]
    )
    assert (top.fruit.id, top.suggested_kg) == ("mango", 8)
    assert tuple(offer.id for offer in top.listings) == (
        "mango-orchard",
        "mango-market",
    )
    sale_total = top.listings[0].price_per_kg_thb * 5
    assert sale_total == Decimal("390.00")

    with marketplace_engine.begin() as db:
        db.exec_driver_sql(
            "UPDATE idea_a_listings SET stock_kg = stock_kg - 5 WHERE id = 'mango-orchard'"
        )
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_orders (id, shop_id, idempotency_key, status, total_thb, created_at)
            VALUES ('saved-order', 'demo', 'b2597665-8ce5-4b0a-82d1-fd475ea08541', 'placed', %s, now())
            """,
            (sale_total,),
        )
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_order_items
            VALUES ('saved-order', 'mango-orchard', 'mango', 'Mango', 'Orchard Direct', 5, 78, %s)
            """,
            (sale_total,),
        )
    manage.seed("--all", planning_date=DAY)
    with marketplace_engine.connect() as db:
        assert db.exec_driver_sql("SELECT count(*) FROM idea_a_shops").scalar_one() == 3
        assert (
            db.exec_driver_sql("SELECT count(*) FROM idea_a_usage").scalar_one() == 63
        )
        assert (
            db.exec_driver_sql("SELECT count(*) FROM idea_a_trend_runs").scalar_one()
            == 1
        )
        assert (
            db.exec_driver_sql(
                "SELECT stock_kg FROM idea_a_listings WHERE id = 'mango-orchard'"
            ).scalar_one()
            == 31
        )
        assert (
            db.exec_driver_sql("SELECT total_thb FROM idea_a_orders").scalar_one()
            == sale_total
        )
        assert (
            db.exec_driver_sql("SELECT qty_kg FROM idea_a_order_items").scalar_one()
            == 5
        )
        assert (
            db.exec_driver_sql(
                "SELECT title FROM idea_b_records WHERE seed_key = 'starter'"
            ).scalar_one()
            == "retained"
        )
