from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.src.modules.idea_a.models import (
    Base,
    Cafe,
    Draft,
    Fruit,
    Plan,
    StockItem,
    StockSnapshot,
    Usage,
)

DELIVERY_DATE = date(2026, 11, 22)
STAMP = datetime(2026, 11, 22, tzinfo=UTC)
QUANTITY = Decimal("8.123456789")


def test_revision_preserves_starter_tables_and_stores_exact_values(
    postgres_engine: Engine,
) -> None:
    assert set(inspect(postgres_engine).get_table_names()) == (
        set(Base.metadata.tables) | {"idea_a_records", "idea_b_records"}
    )
    assert all(name.startswith("idea_a_") for name in Base.metadata.tables)
    with postgres_engine.connect() as connection:
        assert (
            connection.exec_driver_sql("SELECT title FROM idea_b_records").scalar_one()
            == "retained"
        )

    with Session(postgres_engine) as session:
        session.add(Cafe(id="demo", name="Demo Cafe"))
        session.flush()
        session.add(Fruit(cafe_id="demo", fruit_id="mango", name="Mango", position=1))
        session.flush()
        session.add(
            Usage(
                cafe_id="demo",
                fruit_id="mango",
                usage_date=DELIVERY_DATE,
                quantity_kg=QUANTITY,
            )
        )
        session.add(StockSnapshot(id="stock", cafe_id="demo", updated_at=STAMP))
        session.commit()

    with Session(postgres_engine) as session:
        assert session.scalar(select(Usage.quantity_kg)) == QUANTITY
        assert session.scalar(select(StockSnapshot.updated_at)) == STAMP


def plan(plan_id: str) -> Plan:
    return Plan(
        id=plan_id,
        cafe_id="demo",
        delivery_date=DELIVERY_DATE,
        delivery_at=STAMP,
        cutoff_at=STAMP,
        generated_at=STAMP,
        snapshot_id="stock",
        items=[],
    )


def test_revision_enforces_unique_usage_stock_plan_and_draft(
    postgres_engine: Engine,
) -> None:
    def usage() -> Usage:
        return Usage(
            cafe_id="demo",
            fruit_id="mango",
            usage_date=DELIVERY_DATE,
            quantity_kg=QUANTITY,
        )

    def item() -> StockItem:
        return StockItem(
            snapshot_id="stock",
            fruit_id="mango",
            stock_kg=QUANTITY,
            use_today_kg=Decimal(2),
        )

    def draft(draft_id: str) -> Draft:
        return Draft(
            id=draft_id,
            plan_id="first-plan",
            confirmed_at=STAMP,
            items=[],
            message="Message",
        )

    with Session(postgres_engine) as session:
        session.add(Cafe(id="demo", name="Demo Cafe"))
        session.flush()
        session.add(Fruit(cafe_id="demo", fruit_id="mango", name="Mango", position=1))
        session.add(StockSnapshot(id="stock", cafe_id="demo", updated_at=STAMP))
        session.flush()
        session.add_all([usage(), item(), plan("first-plan")])
        session.flush()
        session.add(draft("first-draft"))
        session.commit()

        for duplicate in [usage(), item(), plan("second-plan"), draft("second-draft")]:
            session.add(duplicate)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()
