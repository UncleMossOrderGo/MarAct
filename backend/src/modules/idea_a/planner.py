from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from math import ceil
from typing import Literal
from zoneinfo import ZoneInfo

BANGKOK = ZoneInfo("Asia/Bangkok")
InputCode = Literal["stock", "usage_history"]
ZERO = Decimal(0)


@dataclass(frozen=True)
class Fruit:
    fruit_id: str
    name: str


@dataclass(frozen=True)
class Usage:
    fruit_id: str
    day: date
    quantity_kg: Decimal


@dataclass(frozen=True)
class StockItem:
    fruit_id: str
    stock_kg: Decimal
    use_today_kg: Decimal


@dataclass(frozen=True)
class StockSnapshot:
    updated_at: datetime
    items: tuple[StockItem, ...]
    id: str | None = None


@dataclass(frozen=True)
class Recommendation:
    fruit_id: str
    forecast_kg: Decimal
    usable_stock_kg: Decimal
    suggested_kg: int
    shortage: bool
    surplus: bool


@dataclass(frozen=True)
class PlanningResult:
    items: tuple[Recommendation, ...] = ()
    missing: tuple[InputCode, ...] = ()


def recommend(
    fruits: Sequence[Fruit],
    usage: Sequence[Usage],
    stock: StockSnapshot | None,
    planning_date: date,
) -> PlanningResult:
    expected = {planning_date - timedelta(days=offset) for offset in range(1, 8)}
    history: dict[str, list[Usage]] = defaultdict(list)
    for row in usage:
        if row.day in expected:
            history[row.fruit_id].append(row)

    stock_by_fruit = {item.fruit_id: item for item in stock.items} if stock else {}
    missing: list[InputCode] = []
    if (
        stock is None
        or stock.updated_at.astimezone(BANGKOK).date() != planning_date
        or len(stock.items) != len(fruits)
        or stock_by_fruit.keys() != {fruit.fruit_id for fruit in fruits}
    ):
        missing.append("stock")
    if any(
        len(history[fruit.fruit_id]) != len(expected)
        or {row.day for row in history[fruit.fruit_id]} != expected
        for fruit in fruits
    ):
        missing.append("usage_history")
    if missing:
        return PlanningResult(missing=tuple(missing))

    items = []
    for fruit in fruits:
        forecast = sum((row.quantity_kg for row in history[fruit.fruit_id]), ZERO) / 7
        on_hand = stock_by_fruit[fruit.fruit_id]
        # Prorate the daily mean from 15:30 to midnight, then until delivery at 09:00.
        remaining_today = forecast * Decimal("8.5") / 24
        before_delivery = forecast * 9 / 24
        leftover_must_use = max(ZERO, on_hand.use_today_kg - remaining_today)
        usable = max(
            ZERO,
            on_hand.stock_kg
            - max(remaining_today, on_hand.use_today_kg)
            - before_delivery,
        )
        items.append(
            Recommendation(
                fruit.fruit_id,
                forecast,
                usable,
                ceil(max(ZERO, forecast - usable)),
                forecast > usable,
                leftover_must_use > ZERO,
            )
        )
    return PlanningResult(items=tuple(items))
