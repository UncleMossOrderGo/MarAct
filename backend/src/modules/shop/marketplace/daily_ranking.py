from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from math import ceil

ZERO = Decimal(0)
ONE = Decimal(1)
HISTORY_DAYS = 7


@dataclass(frozen=True)
class TrendFacts:
    slug: str
    confidence: Decimal
    mention_count: int
    momentum: str


@dataclass(frozen=True)
class Observation:
    slug: str
    day: date
    mentions: int


@dataclass(frozen=True)
class Fit:
    slug: str
    fit: Decimal
    priority_ingredient_ids: tuple[str, ...]


@dataclass(frozen=True)
class Offer:
    id: str
    ingredient_id: str
    seller_id: str
    seller_name: str
    price_per_kg_thb: Decimal
    stock_kg: int
    active: bool


@dataclass(frozen=True)
class RankedIngredient:
    ingredient_id: str
    score: Decimal
    suggested_kg: int
    listings: tuple[Offer, ...]
    explanation: str


@dataclass(frozen=True)
class RankedTrend:
    slug: str
    score: Decimal
    trend_rank: Decimal
    momentum: str
    is_new: bool
    ingredients: tuple[RankedIngredient, ...]


def trend_metrics(
    day: date, trend: TrendFacts, observations: Sequence[Observation] = ()
) -> tuple[Decimal, str, bool]:
    previous = [
        row
        for row in observations
        if row.slug == trend.slug
        and day - timedelta(days=HISTORY_DAYS) <= row.day < day
    ]
    score = (
        Decimal("0.6") * trend.confidence
        + Decimal("0.4") * min(trend.mention_count, 5) / 5
    )
    momentum = trend.momentum
    if previous:
        prior = max(previous, key=lambda row: row.day)
        if prior.mentions > 0 and trend.mention_count >= 0:
            ratio = Decimal(trend.mention_count) / prior.mentions
            if ratio >= Decimal("1.20"):
                momentum = "rising"
            elif ratio <= Decimal("0.80"):
                momentum = "fading"
            else:
                momentum = "peak"
    return max(ZERO, min(ONE, score)), momentum, not previous


def _ingredient(
    ingredient_id: str,
    trend_rank: Decimal,
    total: Decimal,
    max_usage: Decimal,
    offers: Sequence[Offer],
) -> RankedIngredient:
    minimum = min(offer.price_per_kg_thb for offer in offers)
    spread = max(offer.price_per_kg_thb for offer in offers) - minimum
    usage = total / max_usage if max_usage else ZERO
    base = Decimal("0.60") * trend_rank + Decimal("0.25") * usage
    scored = []
    for offer in offers:
        value = ONE - (offer.price_per_kg_thb - minimum) / spread if spread else ONE
        scored.append((base + Decimal("0.15") * value, offer))
    scored.sort(key=lambda pair: (-pair[0], pair[1].id))
    score, best = scored[0]
    suggested = ceil(total / HISTORY_DAYS) if total else 2
    return RankedIngredient(
        ingredient_id,
        score,
        suggested,
        tuple(offer for _, offer in scored[:2]),
        f"Suggested {suggested} kg from {best.seller_name} at ฿{best.price_per_kg_thb:.2f}/kg.",
    )


def rank(
    day: date,
    trends: Sequence[TrendFacts],
    insights: Sequence[Fit],
    usage: Mapping[str, Decimal],
    offers: Sequence[Offer],
    observations: Sequence[Observation] = (),
) -> tuple[RankedTrend, ...]:
    by_slug = {trend.slug: trend for trend in trends}
    eligible: dict[str, list[Offer]] = defaultdict(list)
    for offer in offers:
        if offer.active and offer.stock_kg > 0:
            eligible[offer.ingredient_id].append(offer)
    max_usage = max(usage.values(), default=ZERO)
    results = []
    for insight in insights:
        trend = by_slug.get(insight.slug)
        if trend is None or insight.fit < Decimal("0.4"):
            continue
        score, momentum, is_new = trend_metrics(day, trend, observations)
        trend_rank = insight.fit * score
        if momentum == "rising":
            trend_rank += Decimal("0.2") if is_new else Decimal("0.1")
        ingredients = [
            _ingredient(
                ingredient_id,
                trend_rank,
                usage.get(ingredient_id, ZERO),
                max_usage,
                eligible[ingredient_id],
            )
            for ingredient_id in dict.fromkeys(insight.priority_ingredient_ids)
            if ingredient_id in eligible
        ]
        ingredients.sort(key=lambda item: (-item.score, item.ingredient_id))
        results.append(
            RankedTrend(
                trend.slug, score, trend_rank, momentum, is_new, tuple(ingredients[:3])
            )
        )
    return tuple(sorted(results, key=lambda item: (-item.trend_rank, item.slug))[:3])
