from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Protocol
from uuid import uuid4

from .explanations import template
from .planner import (
    BANGKOK,
    Fruit,
    InputCode,
    PlanningResult,
    Recommendation,
    StockItem,
    StockSnapshot,
    Usage,
    recommend,
)

NEXT_DAY = timedelta(days=1)


@dataclass(frozen=True)
class PlanItem(Recommendation):
    explanation: str


@dataclass(frozen=True)
class Plan:
    id: str
    delivery_date: date
    delivery_at: datetime
    cutoff_at: datetime
    generated_at: datetime
    items: tuple[PlanItem, ...]


@dataclass(frozen=True)
class OrderItem:
    fruit_id: str
    quantity_kg: int


@dataclass(frozen=True)
class Draft:
    id: str
    confirmed_at: datetime
    items: tuple[OrderItem, ...]
    message: str


@dataclass(frozen=True)
class Dashboard:
    fruits: tuple[Fruit, ...]
    stock: StockSnapshot | None
    plan: Plan | None
    draft: Draft | None


class MissingInputs(Exception):
    def __init__(self, inputs: tuple[InputCode, ...]) -> None:
        super().__init__(", ".join(inputs))
        self.inputs = inputs


class InvalidItems(ValueError):
    pass


class PlanNotFound(Exception):
    pass


class StalePlan(Exception):
    pass


class Repository(Protocol):
    def catalog(self) -> Sequence[Fruit]: ...
    def recent_usage(self, planning_date: date) -> Sequence[Usage]: ...
    def latest_stock(self) -> StockSnapshot | None: ...
    def save_stock(self, snapshot: StockSnapshot) -> StockSnapshot: ...
    def find_plan_by_date(
        self, delivery_date: date
    ) -> tuple[Plan, Draft | None] | None: ...
    def find_plan_by_id(self, plan_id: str) -> tuple[Plan, Draft | None] | None: ...
    def upsert_plan(
        self, plan: Plan, snapshot: StockSnapshot
    ) -> tuple[Plan, Draft | None]: ...
    def confirm_plan(
        self,
        plan_id: str,
        current_delivery_date: date,
        build_draft: Callable[[], Draft],
    ) -> tuple[Plan, Draft]: ...


def supplier_message(
    day: date, fruits: Sequence[Fruit], items: Sequence[OrderItem]
) -> str:
    quantities = {item.fruit_id: item.quantity_kg for item in items}
    lines = [day.isoformat()]
    for fruit in fruits:
        quantity = quantities[fruit.fruit_id]
        if quantity > 0:
            lines.append(f"{fruit.name}: {quantity} kg")
    return "\n".join(lines)


def _catalog_order[T: (StockItem, OrderItem)](
    fruits: Sequence[Fruit], items: Sequence[T]
) -> tuple[T, ...]:
    by_id = {item.fruit_id: item for item in items}
    if len(items) != len(fruits) or by_id.keys() != {
        fruit.fruit_id for fruit in fruits
    }:
        raise InvalidItems("Include each configured fruit exactly once.")
    return tuple(by_id[fruit.fruit_id] for fruit in fruits)


class PlanningService:
    def __init__(
        self,
        repository: Repository,
        explain: Callable[[Sequence[Recommendation]], Mapping[str, str]],
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
        planner: Callable[
            [Sequence[Fruit], Sequence[Usage], StockSnapshot | None, date],
            PlanningResult,
        ] = recommend,
    ) -> None:
        self.repository = repository
        self.explain = explain
        self.clock = clock
        self.planner = planner

    def save_stock(self, items: Sequence[StockItem]) -> StockSnapshot:
        ordered = _catalog_order(self.repository.catalog(), items)
        for item in ordered:
            if (
                not item.stock_kg.is_finite()
                or not item.use_today_kg.is_finite()
                or not 0 <= item.use_today_kg <= item.stock_kg
            ):
                raise InvalidItems(
                    "Use-today stock must be between zero and on-hand stock."
                )
        return self.repository.save_stock(StockSnapshot(self.clock(), ordered))

    def current(self) -> Dashboard:
        delivery_date = self.clock().astimezone(BANGKOK).date() + NEXT_DAY
        fruits = tuple(self.repository.catalog())
        stock = self.repository.latest_stock()
        plan, draft = self.repository.find_plan_by_date(delivery_date) or (None, None)
        return Dashboard(fruits, stock, plan, draft)

    def run(self, now: datetime | None = None) -> Dashboard:
        local_now = (now or self.clock()).astimezone(BANGKOK)
        today = local_now.date()
        delivery_date = today + NEXT_DAY
        fruits = tuple(self.repository.catalog())
        stock = self.repository.latest_stock()
        existing = self.repository.find_plan_by_date(delivery_date)
        if existing and existing[1] is not None:
            return Dashboard(fruits, stock, *existing)

        usage = self.repository.recent_usage(today)
        result = self.planner(fruits, usage, stock, today)
        recommendations, missing = result.items, result.missing
        if stock is None or missing:
            raise MissingInputs(missing or ("stock",))

        flagged = tuple(
            item for item in recommendations if item.shortage or item.surplus
        )
        explanations = self.explain(flagged) if flagged else {}
        ordered = sorted(
            recommendations, key=lambda item: not (item.shortage or item.surplus)
        )
        items = tuple(
            PlanItem(
                item.fruit_id,
                item.forecast_kg,
                item.usable_stock_kg,
                item.suggested_kg,
                item.shortage,
                item.surplus,
                (explanations.get(item.fruit_id) or template(item))
                if item.shortage or item.surplus
                else "",
            )
            for item in ordered
        )
        plan = Plan(
            str(uuid4()),
            delivery_date,
            datetime.combine(delivery_date, time(9), BANGKOK),
            datetime.combine(today, time(16), BANGKOK),
            local_now,
            items,
        )
        saved, draft = self.repository.upsert_plan(plan, stock)
        return Dashboard(fruits, self.repository.latest_stock(), saved, draft)

    def confirm(self, plan_id: str, items: Sequence[OrderItem]) -> Dashboard:
        if not items or any(
            type(item.quantity_kg) is not int or item.quantity_kg < 0 for item in items
        ):
            raise InvalidItems("Use nonnegative whole kilograms.")
        if len({item.fruit_id for item in items}) != len(items):
            raise InvalidItems("Include each fruit ID once.")

        now = self.clock().astimezone(BANGKOK)
        current_delivery = now.date() + NEXT_DAY
        existing = self.repository.find_plan_by_id(plan_id)
        if existing is None:
            raise PlanNotFound(plan_id)
        plan, draft = existing
        fruits = tuple(self.repository.catalog())
        if draft is not None:
            # Validate against the saved order, so catalog edits do not invalidate a retry.
            if {item.fruit_id for item in items} != {
                item.fruit_id for item in draft.items
            }:
                raise InvalidItems("Include each configured fruit exactly once.")
            return Dashboard(fruits, self.repository.latest_stock(), plan, draft)

        ordered = _catalog_order(fruits, items)

        def build_draft() -> Draft:
            return Draft(
                str(uuid4()),
                now,
                ordered,
                supplier_message(plan.delivery_date, fruits, ordered),
            )

        saved, draft = self.repository.confirm_plan(
            plan_id, current_delivery, build_draft
        )
        return Dashboard(fruits, self.repository.latest_stock(), saved, draft)
