from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from math import ceil

ZERO = Decimal(0)
ONE = Decimal(1)
HISTORY_DAYS = 7


@dataclass(frozen=True)
class Shop:
    id: str
    name: str
    category: str
    menu_tags: tuple[str, ...]


@dataclass(frozen=True)
class Fruit:
    id: str
    name_en: str
    name_th: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class Seller:
    id: str
    name: str
    area: str
    rating: Decimal


@dataclass(frozen=True)
class Listing:
    id: str
    seller: Seller
    fruit: Fruit
    price_per_kg_thb: Decimal
    stock_kg: int
    active: bool


@dataclass(frozen=True)
class UsageTotal:
    fruit_id: str
    total_kg: Decimal


@dataclass(frozen=True)
class TrendSignal:
    fruit_id: str
    score: Decimal
    trend_name: str


@dataclass(frozen=True)
class RankingWeights:
    history: Decimal = Decimal("0.35")
    profile: Decimal = Decimal("0.25")
    trend: Decimal = Decimal("0.30")
    value: Decimal = Decimal("0.10")


@dataclass(frozen=True)
class RankedFruit:
    fruit: Fruit
    score: Decimal
    suggested_kg: int
    trend_name: str | None
    matching_tag: str | None
    listings: tuple[Listing, ...]


def rank(
    shop: Shop,
    usage: Sequence[UsageTotal],
    listings: Sequence[Listing],
    trends: Sequence[TrendSignal],
    weights: RankingWeights = RankingWeights(),
) -> tuple[RankedFruit, ...]:
    totals = {entry.fruit_id: entry.total_kg for entry in usage}
    max_usage = max(totals.values(), default=ZERO)
    signals = {trend.fruit_id: trend for trend in trends}
    tags = set(shop.menu_tags)
    eligible: dict[str, list[Listing]] = defaultdict(list)
    for listing in listings:
        if listing.active and listing.stock_kg > 0:
            eligible[listing.fruit.id].append(listing)

    ranked = []
    for fruit_id, offers in eligible.items():
        fruit = offers[0].fruit
        matched = tags.intersection(fruit.tags)
        profile = Decimal(len(matched)) / len(tags) if tags else ZERO
        total = totals.get(fruit_id, ZERO)
        history = total / max_usage if max_usage else ZERO
        trend = signals.get(fruit_id)
        trend_score = trend.score if trend else ZERO
        suggested = (
            ceil(total / HISTORY_DAYS) if total else 2 * (trend_score > Decimal("0.5"))
        )
        minimum = min(offer.price_per_kg_thb for offer in offers)
        spread = max(offer.price_per_kg_thb for offer in offers) - minimum
        base = (
            weights.history * history
            + weights.profile * profile
            + weights.trend * trend_score
        )

        scored = []
        for offer in offers:
            value = ONE - (offer.price_per_kg_thb - minimum) / spread if spread else ONE
            stock_factor = ONE if offer.stock_kg >= suggested else Decimal("0.5")
            score = (base + weights.value * value) * stock_factor
            scored.append((score, offer))
        scored.sort(key=lambda pair: (-pair[0], pair[1].price_per_kg_thb, pair[1].id))
        item = RankedFruit(
            fruit,
            scored[0][0],
            suggested,
            trend.trend_name if trend else None,
            min(matched, default=None),
            tuple(offer for _, offer in scored[:2]),
        )
        ranked.append((item, trend_score))

    ranked.sort(
        key=lambda pair: (
            -pair[0].score,
            -pair[1],
            pair[0].listings[0].price_per_kg_thb,
            pair[0].fruit.id,
        )
    )
    return tuple(item for item, _ in ranked[:5])
