"""Run the daily trend pipeline independently of HTTP and the scheduler."""

import logging
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Protocol

from ..planner import BANGKOK
from .category_fit import CategoryInsight
from .daily_discovery import DailyDiscoveryFailure, DailyTrend
from .daily_ranking import (
    Fit,
    Observation,
    Offer,
    RankedTrend,
    TrendFacts,
    rank,
    trend_metrics,
)
from .ingredient_extraction import IngredientCatalogItem, IngredientMatch

logger = logging.getLogger(__name__)

JobState = Literal["running", "published", "error"]
PublicationStatus = Literal["ok", "fallback"]
PublicationSource = Literal["live", "seed"]
Matches = Mapping[str, Sequence[IngredientMatch]]
Insights = Mapping[str, CategoryInsight]
Discover = Callable[[date, Sequence[IngredientCatalogItem]], Sequence[DailyTrend]]
Extract = Callable[[Sequence[DailyTrend], Sequence[IngredientCatalogItem]], Matches]
MatchCategory = Callable[[str, Sequence[DailyTrend], Matches], Insights]


@dataclass(frozen=True)
class JobAttempt:
    id: str
    trend_date: date
    started_at: datetime
    state: JobState
    finished_at: datetime | None = None
    publication_id: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class Publication:
    id: str
    trend_date: date
    started_at: datetime
    finished_at: datetime
    status: PublicationStatus
    source: PublicationSource


@dataclass(frozen=True)
class JobStatus:
    attempt: JobAttempt | None = None
    publication: Publication | None = None


@dataclass(frozen=True)
class ShopInputs:
    id: str
    category: str
    usage: Mapping[str, Decimal]


@dataclass(frozen=True)
class JobInputs:
    catalog: Sequence[IngredientCatalogItem]
    shops: Sequence[ShopInputs]
    offers: Sequence[Offer]
    observations: Sequence[Observation] = ()


@dataclass(frozen=True)
class Enrichment:
    trends: Sequence[DailyTrend]
    ingredients: Matches
    categories: Mapping[str, Insights]


@dataclass(frozen=True)
class PublishedTrend:
    trend: DailyTrend
    score: Decimal
    momentum: str
    is_new: bool


@dataclass(frozen=True)
class Snapshot:
    publication: Publication
    trends: Sequence[PublishedTrend]
    ingredients: Matches
    categories: Mapping[str, Insights]
    recommendations: Mapping[str, Sequence[RankedTrend]]


class PublicationStore(Protocol):
    def reserve(self, trend_date: date, now: datetime) -> tuple[JobAttempt, bool]: ...
    def latest(self) -> JobStatus: ...
    def inputs(self, trend_date: date) -> JobInputs: ...
    def seed(self) -> Enrichment: ...
    def publish(self, attempt: JobAttempt, snapshot: Snapshot) -> JobAttempt: ...
    def fail(self, attempt: JobAttempt, now: datetime, error: str) -> JobAttempt: ...


class NoUsableTrends(Exception):
    pass


class DailyJob:
    def __init__(
        self,
        store: PublicationStore,
        discover: Discover,
        extract: Extract,
        match_category: MatchCategory,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
        use_seed: bool = False,
    ) -> None:
        self.store = store
        self.discover = discover
        self.extract = extract
        self.match_category = match_category
        self.clock = clock
        self.use_seed = use_seed
        self._worker = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="idea-a-daily"
        )

    def close(self) -> None:
        self._worker.shutdown()

    def latest(self) -> JobStatus:
        return self.store.latest()

    def trigger(self, trend_date: date | None = None) -> JobAttempt:
        attempt, owner = self._reserve(trend_date)
        if owner:
            try:
                self._worker.submit(self._execute, attempt)
            except RuntimeError:
                return self.store.fail(attempt, self.clock(), "worker_unavailable")
        return attempt

    def run(self, trend_date: date | None = None) -> JobAttempt:
        """Execute synchronously unless another trigger already owns the attempt."""
        attempt, owner = self._reserve(trend_date)
        return self._execute(attempt) if owner else attempt

    def _reserve(self, trend_date: date | None) -> tuple[JobAttempt, bool]:
        now = self.clock()
        return self.store.reserve(trend_date or now.astimezone(BANGKOK).date(), now)

    def _execute(self, attempt: JobAttempt) -> JobAttempt:
        try:
            inputs = self.store.inputs(attempt.trend_date)
            enriched, source = self._enrich(attempt.trend_date, inputs)
            if not enriched.trends:
                raise NoUsableTrends
            snapshot = self._snapshot(attempt, inputs, enriched, source)
            return self.store.publish(attempt, snapshot)
        except NoUsableTrends:
            logger.warning(
                "Idea A daily trend attempt %s has no usable trends", attempt.id
            )
            return self.store.fail(attempt, self.clock(), "no_usable_trends")
        except Exception:
            logger.exception("Idea A daily trend attempt %s failed", attempt.id)
            return self.store.fail(attempt, self.clock(), "publication_failed")

    def _enrich(
        self, day: date, inputs: JobInputs
    ) -> tuple[Enrichment, PublicationSource]:
        if self.use_seed:
            return self.store.seed(), "seed"
        try:
            trends = self.discover(day, inputs.catalog)
        except (DailyDiscoveryFailure, TimeoutError):
            trends = ()
        if not trends:
            return self.store.seed(), "seed"

        ingredients = self.extract(trends, inputs.catalog)
        stocked = {
            offer.ingredient_id
            for offer in inputs.offers
            if offer.active and offer.stock_kg > 0
        }
        stock_matches = {
            slug: tuple(match for match in matches if match.ingredient_id in stocked)
            for slug, matches in ingredients.items()
        }
        categories = {
            category: self.match_category(category, trends, stock_matches)
            for category in sorted({shop.category for shop in inputs.shops})
        }
        return Enrichment(trends, ingredients, categories), "live"

    def _snapshot(
        self,
        attempt: JobAttempt,
        inputs: JobInputs,
        enriched: Enrichment,
        source: PublicationSource,
    ) -> Snapshot:
        day = attempt.trend_date
        facts = [
            TrendFacts(
                trend.slug,
                Decimal(str(trend.confidence)),
                len({entry.url for entry in trend.sources}),
                trend.momentum,
            )
            for trend in enriched.trends
        ]
        trends = [
            PublishedTrend(trend, *trend_metrics(day, fact, inputs.observations))
            for trend, fact in zip(enriched.trends, facts, strict=True)
        ]
        recommendations = {}
        for shop in inputs.shops:
            fits = [
                Fit(
                    slug,
                    Decimal(str(insight.fit)),
                    tuple(insight.priority_ingredient_ids),
                )
                for slug, insight in enriched.categories.get(shop.category, {}).items()
            ]
            recommendations[shop.id] = rank(
                day, facts, fits, shop.usage, inputs.offers, inputs.observations
            )
        publication = Publication(
            attempt.id,
            day,
            attempt.started_at,
            max(attempt.started_at, self.clock()),
            "ok" if source == "live" else "fallback",
            source,
        )
        return Snapshot(
            publication,
            trends,
            enriched.ingredients,
            enriched.categories,
            recommendations,
        )
