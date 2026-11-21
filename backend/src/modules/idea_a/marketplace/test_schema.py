from datetime import date
from decimal import Decimal

import pytest
from psycopg.conninfo import make_conninfo
from sqlalchemy import inspect, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from backend.db import manage
from backend.src.modules.idea_a.marketplace import models
from backend.src.shared.db import database_url


def test_marketplace_tables_match_mappings(marketplace_engine: Engine) -> None:
    inspector = inspect(marketplace_engine)
    assert len(models.Base.metadata.tables) == 10
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
            == "idea_a_0002"
        )
