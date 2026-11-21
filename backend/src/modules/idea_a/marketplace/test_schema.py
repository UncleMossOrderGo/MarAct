from datetime import date
from decimal import Decimal

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from psycopg.conninfo import make_conninfo
from sqlalchemy import inspect, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.db import manage
from backend.db.alembic.versions import idea_a_0003
from backend.src.modules.idea_a.marketplace import models
from backend.src.shared.db import database_url


def test_marketplace_tables_match_mappings(marketplace_engine: Engine) -> None:
    inspector = inspect(marketplace_engine)
    tables = set(models.Base.metadata.tables)
    assert {"idea_a_orders", "idea_a_daily_runs", "idea_a_recommendations"}.issubset(
        tables
    )
    for name, mapping in models.Base.metadata.tables.items():
        assert set(mapping.columns.keys()) == {
            entry["name"] for entry in inspector.get_columns(name)
        }
        assert (
            list(mapping.primary_key.columns.keys())
            == inspector.get_pk_constraint(name)["constrained_columns"]
        )


def test_make_migration_retains_v1_data_and_migrates_compatible_usage(
    postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    with postgres_engine.begin() as db:
        schema = db.exec_driver_sql("SELECT current_schema()").scalar_one()
        db.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY)"
        )
        db.exec_driver_sql(
            "INSERT INTO schema_migrations VALUES "
            "('0001_idea_a_records.sql'), ('0002_idea_b_records.sql')"
        )
        db.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"
        )
        db.exec_driver_sql("INSERT INTO alembic_version VALUES ('idea_a_0001')")
        db.exec_driver_sql(
            "INSERT INTO idea_a_cafes VALUES ('shop-x', 'Existing Café')"
        )
        db.exec_driver_sql(
            "INSERT INTO idea_a_fruits VALUES ('shop-x', 'mango', 'Existing Mango', 0)"
        )
        db.exec_driver_sql(
            "INSERT INTO idea_a_usage VALUES "
            "('shop-x', 'mango', '2026-11-20', 2.75), ('shop-x', 'mango', '2026-11-19', 'NaN')"
        )
        db.exec_driver_sql(
            "INSERT INTO idea_a_stock_snapshots VALUES ('stock', 'shop-x', now())"
        )

    monkeypatch.setenv(
        "DATABASE_URL", make_conninfo(database_url(), options=f"-csearch_path={schema}")
    )
    manage.migrate()
    manage.migrate()

    with Session(postgres_engine) as session:
        shop = session.get(models.Shop, "shop-x")
        assert shop is not None and shop.name == "Existing Café"
        usage = session.scalars(select(models.Usage)).one()
        assert (usage.shop_id, usage.fruit_id, usage.usage_date, usage.quantity_kg) == (
            "shop-x",
            "mango",
            date(2026, 11, 20),
            Decimal("2.75"),
        )
    config = Config()
    config.set_main_option("script_location", str(manage.DB / "alembic"))
    with postgres_engine.connect() as db:
        assert (
            db.exec_driver_sql("SELECT count(*) FROM idea_a_legacy_usage").scalar_one()
            == 2
        )
        assert (
            db.exec_driver_sql("SELECT count(*) FROM idea_a_legacy_fruits").scalar_one()
            == 1
        )
        assert (
            db.exec_driver_sql("SELECT id FROM idea_a_stock_snapshots").scalar_one()
            == "stock"
        )
        assert (
            db.exec_driver_sql("SELECT title FROM idea_b_records").scalar_one()
            == "retained"
        )
        assert (
            db.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one()
            == ScriptDirectory.from_config(config).get_current_head()
        )


def test_daily_upgrade_preserves_existing_marketplace_order(
    marketplace_v2_engine: Engine,
) -> None:
    with marketplace_v2_engine.begin() as db:
        db.exec_driver_sql(
            "INSERT INTO idea_a_shops VALUES ('shop', 'Bakery', 'bakery', '[]')"
        )
        db.exec_driver_sql(
            "INSERT INTO idea_a_fruits VALUES ('mango', 'Mango', 'มะม่วง', '[]')"
        )
        db.exec_driver_sql(
            "INSERT INTO idea_a_sellers VALUES ('seller', 'Seller', 'Bangkok', 4.5)"
        )
        db.exec_driver_sql(
            "INSERT INTO idea_a_listings VALUES ('listing', 'seller', 'mango', 55, 8, true)"
        )
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_orders (id, shop_id, idempotency_key, status, total_thb, created_at)
            VALUES ('order', 'shop', '24cc6935-11e9-4075-901b-c6255d5dab34', 'confirmed', 110, now())
            """
        )
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_order_items
                (order_id, listing_id, fruit_id, fruit_name, seller_name, qty_kg, price_per_kg_thb, line_total_thb)
            VALUES ('order', 'listing', 'mango', 'Mango', 'Seller', 2, 55, 110)
            """
        )
        with Operations.context(MigrationContext.configure(db)):
            idea_a_0003.upgrade()

        with Session(db) as session:
            order = session.get(models.Order, "order")
            assert order is not None and order.total_thb == Decimal("110.00")
            item = session.get(models.OrderItem, ("order", 0))
            assert item is not None
            assert item.ingredient_id == "mango"
            assert item.qty_kg == 2
            assert item.line_total_thb == Decimal("110.00")
            assert item.trend_slug is None and item.trend_label is None
        assert (
            db.exec_driver_sql("SELECT title FROM idea_b_records").scalar_one()
            == "retained"
        )


def test_daily_run_is_unique_and_allows_unmatched_ingredient(
    marketplace_engine: Engine,
) -> None:
    with marketplace_engine.begin() as db:
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_daily_runs VALUES ('run', '2026-11-21', now(), now(), 'fallback', 'seed')
            """
        )
        with pytest.raises(IntegrityError), db.begin_nested():
            db.exec_driver_sql(
                """
                INSERT INTO idea_a_daily_runs VALUES ('second', '2026-11-21', now(), now(), 'ok', 'live')
                """
            )
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_daily_trends VALUES
                ('run', 'gelato', 'Gelato', 'เจลาโต', 'dessert', 'rising', true, 'Rising', 'กำลังมาแรง', NULL, '[]', 0.7)
            """
        )
        db.exec_driver_sql(
            """
            INSERT INTO idea_a_daily_trend_ingredients VALUES
                ('run', 'gelato', 0, 'kataifi topping', 'ท็อปปิงคาตาอิฟี', NULL)
            """
        )
        assert db.exec_driver_sql(
            "SELECT ingredient_id FROM idea_a_daily_trend_ingredients"
        ).one() == (None,)
