from datetime import date, timedelta
from decimal import Decimal

from .daily_ranking import Fit, Observation, Offer, TrendFacts, rank, trend_metrics

DAY = date(2026, 11, 21)
TREND = TrendFacts("gelato", Decimal("0.8"), 3, "rising")


def offer(key, ingredient, price, stock=10):
    return Offer(key, ingredient, key, key, Decimal(price), stock, True)


def test_momentum_and_novelty_boundaries():
    assert trend_metrics(DAY, TREND) == (Decimal("0.72"), "rising", True)
    assert trend_metrics(
        DAY, TREND, (Observation("gelato", DAY - timedelta(days=7), 4),)
    ) == (
        Decimal("0.72"),
        "fading",
        False,
    )
    assert trend_metrics(
        DAY, TREND, (Observation("gelato", DAY - timedelta(days=8), 4),)
    )[2]
    assert (
        trend_metrics(DAY, TREND, (Observation("gelato", DAY - timedelta(days=1), 3),))[
            1
        ]
        == "peak"
    )


def test_rank_uses_shop_usage_caps_and_stable_offer_ties():
    ids = ("paste", "cream", "milk", "empty")
    (result,) = rank(
        DAY,
        (TREND,),
        (Fit(TREND.slug, Decimal("0.9"), ids),),
        {"paste": Decimal(14), "cream": Decimal(35), "milk": Decimal(70)},
        (
            offer("b", "paste", "820"),
            offer("a", "paste", "820"),
            offer("c", "paste", "870"),
            offer("cream", "cream", "195"),
            offer("milk", "milk", "42"),
            offer("empty", "empty", "1", 0),
        ),
    )
    assert result.trend_rank == Decimal("0.848")
    assert {row.ingredient_id: row.suggested_kg for row in result.ingredients} == {
        "paste": 2,
        "cream": 5,
        "milk": 10,
    }
    assert [row.id for row in result.ingredients[-1].listings] == ["a", "b"]


def test_zero_usage_seller_value_and_trend_caps():
    trends = tuple(TrendFacts(str(i), Decimal("0.5"), 1, "peak") for i in range(5))
    ids = tuple(str(i) for i in range(4))
    result = rank(
        DAY,
        trends,
        tuple(Fit(row.slug, Decimal("0.4"), ids) for row in trends),
        {},
        tuple(offer(i, i, "30") for i in ids),
    )
    assert [trend.slug for trend in result] == ["0", "1", "2"]
    assert [item.ingredient_id for item in result[0].ingredients] == ["0", "1", "2"]
    assert all(item.suggested_kg == 2 for item in result[0].ingredients)
    assert result[0].ingredients[0].score == Decimal("0.2412")
