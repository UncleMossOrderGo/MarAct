from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from .planner import BANGKOK, Fruit, Recommendation, StockItem, Usage
from .scheduler import DailyCheck
from .workflow import InvalidItems, MissingInputs, OrderItem, PlanningService, StalePlan

NOW = datetime(2026, 11, 21, 15, 30, tzinfo=BANGKOK)
FRUITS = (Fruit("banana", "Banana"), Fruit("mango", "Mango"))
STOCK = (
    StockItem("mango", Decimal(8), Decimal(3)),
    StockItem("banana", Decimal(9), Decimal(0)),
)


class MemoryRepository:
    def __init__(self):
        self.stock = None
        self.usage = ()
        self.plans = {}

    def catalog(self):
        return FRUITS

    def recent_usage(self, planning_date):
        return self.usage

    def latest_stock(self):
        return self.stock

    def save_stock(self, snapshot):
        self.stock = snapshot
        return snapshot

    def find_plan_by_date(self, delivery_date):
        return self.plans.get(delivery_date)

    def find_plan_by_id(self, plan_id):
        return next(
            (entry for entry in self.plans.values() if entry[0].id == plan_id), None
        )

    def upsert_plan(self, plan, snapshot):
        existing = self.find_plan_by_date(plan.delivery_date)
        if existing is not None:
            plan = replace(plan, id=existing[0].id)
        self.plans[plan.delivery_date] = (plan, None)
        return self.plans[plan.delivery_date]

    def confirm_plan(self, plan_id, current_delivery_date, build_draft):
        plan, draft = self.find_plan_by_id(plan_id)
        if draft is None:
            if plan.delivery_date != current_delivery_date:
                raise StalePlan(plan_id)
            draft = build_draft()
            self.plans[plan.delivery_date] = (plan, draft)
        return plan, draft


@pytest.fixture
def workflow():
    repo = MemoryRepository()
    now = [NOW]
    explained: list[Recommendation] = []

    def explain(items):
        explained.extend(items)
        return {"mango": "Mango needs attention."}

    return repo, PlanningService(repo, explain, clock=lambda: now[0]), now, explained


def prepare(workflow):
    repo, service, _, _ = workflow
    repo.usage = tuple(
        Usage(fruit.fruit_id, NOW.date() - timedelta(days=offset), Decimal(quantity))
        for fruit, quantity in zip(FRUITS, (3, 8), strict=True)
        for offset in range(1, 8)
    )
    service.save_stock(STOCK)
    result = service.run()
    assert result.plan is not None
    return result.plan


def test_missing_inputs_and_validation(workflow):
    repo, service, _, _ = workflow
    assert service.current().plan is None
    with pytest.raises(MissingInputs) as error:
        service.run()
    assert error.value.inputs == ("stock", "usage_history")
    with pytest.raises(InvalidItems):
        service.save_stock(STOCK[:1])
    assert repo.stock is None


def test_confirm_edited_order_and_retry_after_rollover(workflow):
    repo, service, now, explained = workflow
    plan = prepare(workflow)
    assert plan.items[0].suggested_kg == 6
    assert [item.fruit_id for item in explained] == ["mango"]
    assert plan.items[0].explanation == "Mango needs attention."
    assert plan.items[1].explanation == ""
    assert plan.delivery_at.hour == 9 and plan.cutoff_at.hour == 16
    order = (OrderItem("mango", 5), OrderItem("banana", 0))
    confirmed = service.confirm(plan.id, order)
    assert confirmed.draft is not None
    assert confirmed.draft.message == "2026-11-22\nMango: 5 kg"
    repo.stock = None
    assert service.run().draft == confirmed.draft
    now[0] += timedelta(days=1)
    assert service.current().draft is None
    assert (
        service.confirm(plan.id, (OrderItem("mango", 9), order[1])).draft
        == confirmed.draft
    )
    with pytest.raises(InvalidItems):
        service.confirm(plan.id, (OrderItem("unknown", 9), order[1]))


@pytest.mark.parametrize("rollover", [False, True])
def test_zero_order_and_stale_plan(workflow, rollover):
    _, service, now, _ = workflow
    plan = prepare(workflow)
    order = tuple(OrderItem(fruit.fruit_id, 0) for fruit in FRUITS)
    if rollover:
        now[0] += timedelta(days=1)
        with pytest.raises(StalePlan):
            service.confirm(plan.id, order)
    else:
        draft = service.confirm(plan.id, order).draft
        assert draft is not None
        assert draft.message == "2026-11-22"


def test_saving_stock_only_changes_snapshot_until_rerun(workflow):
    _, service, _, _ = workflow
    plan = prepare(workflow)
    items = (StockItem("mango", Decimal(9), Decimal(3)), STOCK[1])
    snapshot = service.save_stock(items)
    dashboard = service.current()
    assert dashboard.stock == snapshot
    assert dashboard.plan == plan

    refreshed = service.run().plan
    assert refreshed is not None
    assert refreshed.id == plan.id
    assert refreshed.items[0].suggested_kg == 5


def test_scheduled_run_matches_manual_plan(workflow):
    _, service, _, _ = workflow
    manual = prepare(workflow)
    scheduled = []
    DailyCheck(lambda now: scheduled.append(service.run(now).plan)).tick(NOW)
    assert scheduled == [manual]
