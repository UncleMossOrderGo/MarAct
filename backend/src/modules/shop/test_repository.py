from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Barrier, Event

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from . import models
from .planner import Fruit, StockItem, StockSnapshot, Usage
from .repository import SqlAlchemyRepository
from .workflow import Draft, OrderItem, Plan, PlanItem, PlanNotFound, StalePlan

NOW = datetime(2026, 11, 21, 8, tzinfo=UTC)
TODAY = NOW.date()
DELIVERY = TODAY + timedelta(days=1)


@pytest.fixture
def repository(postgres_engine: Engine) -> SqlAlchemyRepository:
    with Session(postgres_engine) as session, session.begin():
        session.add_all([models.Cafe(id="demo", name="Demo"), models.Cafe(id="other", name="Other")])
        session.flush()
        session.add_all(
            [
                models.Fruit(cafe_id="demo", fruit_id="mango", name="Mango", position=0),
                models.Fruit(cafe_id="demo", fruit_id="banana", name="Banana", position=1),
                models.Fruit(cafe_id="other", fruit_id="apple", name="Apple", position=0),
            ]
        )
        session.flush()
        session.add_all(
            models.Usage(
                cafe_id="demo", fruit_id="mango", usage_date=TODAY - timedelta(days=days),
                quantity_kg=Decimal("8.25"),
            )
            for days in (0, 1, 7, 8)
        )
    return SqlAlchemyRepository(postgres_engine, "demo")


def stock(repository: SqlAlchemyRepository, minutes: int) -> StockSnapshot:
    return repository.save_stock(
        StockSnapshot(
            updated_at=NOW + timedelta(minutes=minutes),
            items=(StockItem("mango", Decimal("2.25"), Decimal("0.25")),),
        )
    )


def plan(plan_id: str, minutes: int, quantity: int) -> Plan:
    return Plan(
        id=plan_id,
        delivery_date=DELIVERY,
        delivery_at=NOW + timedelta(days=1),
        cutoff_at=NOW,
        generated_at=NOW + timedelta(minutes=minutes),
        items=(
            PlanItem(
                fruit_id="mango", forecast_kg=Decimal("8.25"), usable_stock_kg=Decimal("2.25"),
                suggested_kg=quantity, shortage=True, surplus=False, explanation="Order mango.",
            ),
        ),
    )


def test_reads_catalog_usage_and_latest_stock(repository: SqlAlchemyRepository) -> None:
    assert repository.catalog() == (Fruit("mango", "Mango"), Fruit("banana", "Banana"))
    assert repository.recent_usage(TODAY) == tuple(
        Usage("mango", TODAY - timedelta(days=days), Decimal("8.25")) for days in (7, 1)
    )
    assert repository.latest_stock() is None
    recent = stock(repository, 1)
    stock(repository, 0)
    assert repository.latest_stock() == recent
    assert SqlAlchemyRepository(repository.engine, "other").latest_stock() is None


def test_parallel_runs_keep_newer_stock_and_one_plan(repository: SqlAlchemyRepository) -> None:
    old = stock(repository, 0)
    latest = stock(repository, 1)
    old_plan = plan("old", 3, 6)
    new_plan = plan("new", 2, 5)
    barrier = Barrier(2)

    def run(candidate: Plan, snapshot: StockSnapshot) -> Plan:
        barrier.wait(timeout=5)
        return repository.upsert_plan(candidate, snapshot)[0]

    with ThreadPoolExecutor(max_workers=2) as pool:
        old_result = pool.submit(run, old_plan, old)
        new_result = pool.submit(run, new_plan, latest)
        assert old_result.result().id == new_result.result().id

    saved = repository.find_plan_by_date(DELIVERY)
    assert saved is not None
    assert saved[0].items == new_plan.items
    assert saved[0].generated_at == new_plan.generated_at
    assert repository.find_plan_by_id(saved[0].id) == saved
    assert repository.upsert_plan(old_plan, old) == saved


def test_confirmation_holds_plan_against_refresh_and_returns_original_draft(
    repository: SqlAlchemyRepository,
) -> None:
    first = stock(repository, 0)
    latest = stock(repository, 1)
    original = plan("original", 0, 6)
    replacement = plan("replacement", 1, 4)
    repository.upsert_plan(original, first)

    draft = Draft("draft", NOW, (OrderItem("mango", 5),), f"{DELIVERY}\nMango: 5 kg")
    confirming = Event()
    refresh_started = Event()

    def build() -> Draft:
        confirming.set()
        assert refresh_started.wait(timeout=5)
        return draft

    def refresh() -> tuple[Plan, Draft | None]:
        assert confirming.wait(timeout=5)
        refresh_started.set()
        return repository.upsert_plan(replacement, latest)

    def unexpected_draft() -> Draft:
        pytest.fail("A saved or invalid plan must not build a draft")

    with ThreadPoolExecutor(max_workers=2) as pool:
        confirmation = pool.submit(repository.confirm_plan, original.id, DELIVERY, build)
        rerun = pool.submit(refresh)
        assert confirmation.result() == (original, draft)
        assert rerun.result() == (original, draft)

    assert repository.confirm_plan(original.id, DELIVERY + timedelta(days=1), unexpected_draft) == (
        original, draft,
    )
    with pytest.raises(PlanNotFound):
        repository.confirm_plan("missing", DELIVERY, unexpected_draft)
    with pytest.raises(PlanNotFound):
        SqlAlchemyRepository(repository.engine, "other").confirm_plan(original.id, DELIVERY, unexpected_draft)


def test_stale_unconfirmed_plan_is_not_saved(repository: SqlAlchemyRepository) -> None:
    original = plan("original", 0, 6)
    repository.upsert_plan(original, stock(repository, 0))

    def unexpected_draft() -> Draft:
        pytest.fail("A stale unconfirmed plan must not build a draft")

    with pytest.raises(StalePlan):
        repository.confirm_plan(original.id, DELIVERY + timedelta(days=1), unexpected_draft)
    assert repository.find_plan_by_id(original.id) == (original, None)
