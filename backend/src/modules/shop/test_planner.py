from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from backend.src.modules.shop.planner import (
    BANGKOK,
    Fruit,
    StockItem,
    StockSnapshot,
    Usage,
    recommend,
)

DAY = date(2026, 11, 21)
FRUITS = (Fruit("mango", "Mango"),)
USAGE = tuple(Usage("mango", DAY - timedelta(days=i), Decimal(8)) for i in range(1, 8))


def stock(on_hand: str, must_use: str, age: int = 0) -> StockSnapshot:
    return StockSnapshot(
        datetime(2026, 11, 21, 12, tzinfo=BANGKOK) - timedelta(days=age),
        (StockItem("mango", Decimal(on_hand), Decimal(must_use)),),
    )


@pytest.mark.parametrize(
    ("on_hand", "must_use", "usable", "order", "shortage", "surplus"),
    [
        ("8", "3", "2", 6, True, True),
        ("13.1", "3", "7.1", 1, True, True),
        ("20", "9", "8", 0, False, True),
        ("14", "2", "8.16666666666666666666666667", 0, False, False),
        ("4", "2", "0", 8, True, False),
        ("10", "9", "0", 8, True, True),
    ],
)
def test_recommendation(on_hand, must_use, usable, order, shortage, surplus):
    (item,) = recommend(FRUITS, USAGE, stock(on_hand, must_use), DAY).items
    assert (item.forecast_kg, item.usable_stock_kg, item.suggested_kg) == (
        8,
        Decimal(usable),
        order,
    )
    assert (item.shortage, item.surplus) == (shortage, surplus)


def test_stale_stock_and_duplicate_usage_are_reported_together():
    assert recommend(
        FRUITS, USAGE[:-1] + USAGE[:1], stock("10", "3", 1), DAY
    ).missing == (
        "stock",
        "usage_history",
    )
    assert recommend(FRUITS, USAGE, None, DAY).missing == ("stock",)
