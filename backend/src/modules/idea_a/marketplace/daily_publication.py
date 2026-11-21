"""PostgreSQL storage for attempts and complete daily publications."""

from collections import defaultdict
from collections.abc import Callable
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import cast
from uuid import uuid4

from sqlalchemy import Engine, delete, func, select, text
from sqlalchemy.orm import Session

from . import models
from .daily_job import (
    Enrichment,
    JobAttempt,
    JobInputs,
    JobState,
    JobStatus,
    Publication,
    PublicationSource,
    PublicationStatus,
    ShopInputs,
    Snapshot,
)
from .daily_ranking import Observation, Offer
from .ingredient_extraction import IngredientCatalogItem
from .notifications import publish_daily_notifications

# Each API adapter has its own advisory lock. Hold this one only during reservation.
_JOB_LOCK = 428912
_ABANDONED_AFTER = timedelta(minutes=15)


def _attempt(row: models.DailyJobAttempt) -> JobAttempt:
    return JobAttempt(
        row.id,
        row.trend_date,
        row.started_at,
        cast(JobState, row.state),
        row.finished_at,
        row.publication_id,
        row.error,
    )


def _running(session: Session, attempt: JobAttempt) -> models.DailyJobAttempt:
    row = session.scalar(
        select(models.DailyJobAttempt)
        .where(models.DailyJobAttempt.id == attempt.id)
        .with_for_update()
    )
    if row is None or row.state != "running":
        raise RuntimeError("Daily trend attempt no longer owns publication.")
    return row


class SqlPublicationStore:
    def __init__(
        self, engine: Engine, seed: Callable[[], Enrichment], *,
        single_shop: bool = False, notify: bool = False,
    ) -> None:
        self.engine = engine
        self.seed = seed
        self.single_shop = single_shop
        self.notify = notify

    def reserve(self, trend_date: date, now: datetime) -> tuple[JobAttempt, bool]:
        with Session(self.engine) as session, session.begin():
            session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": _JOB_LOCK}
            )
            current = session.scalar(
                select(models.DailyJobAttempt)
                .where(models.DailyJobAttempt.state == "running")
                .with_for_update()
            )
            if current is not None:
                if now - current.started_at < _ABANDONED_AFTER:
                    return _attempt(current), False
                current.state = "error"
                current.finished_at = now
                current.error = "abandoned"
                session.flush()

            row = models.DailyJobAttempt(
                id=str(uuid4()), trend_date=trend_date, started_at=now, state="running"
            )
            session.add(row)
            session.flush()
            return _attempt(row), True

    def latest(self) -> JobStatus:
        with Session(self.engine) as session:
            attempt = session.scalar(
                select(models.DailyJobAttempt)
                .order_by(models.DailyJobAttempt.sequence.desc())
                .limit(1)
            )
            row = session.scalar(
                select(models.DailyRun)
                .order_by(models.DailyRun.trend_date.desc())
                .limit(1)
            )
            publication = None
            if row is not None:
                publication = Publication(
                    row.id,
                    row.trend_date,
                    row.started_at,
                    row.finished_at,
                    cast(PublicationStatus, row.status),
                    cast(PublicationSource, row.source),
                )
            return JobStatus(
                _attempt(attempt) if attempt is not None else None, publication
            )

    def inputs(self, trend_date: date) -> JobInputs:
        first_day = trend_date - timedelta(days=7)
        with Session(self.engine) as session:
            catalog = tuple(
                IngredientCatalogItem(
                    item.id, item.name_en, item.name_th, tuple(item.aliases)
                )
                for item in session.scalars(
                    select(models.Ingredient).order_by(models.Ingredient.id)
                )
            )
            usage: dict[str, dict[str, Decimal]] = defaultdict(dict)
            for shop_id, ingredient_id, total in session.execute(
                select(
                    models.Usage.shop_id,
                    models.Usage.ingredient_id,
                    func.sum(models.Usage.quantity_kg),
                )
                .where(
                    models.Usage.usage_date >= first_day,
                    models.Usage.usage_date < trend_date,
                )
                .group_by(models.Usage.shop_id, models.Usage.ingredient_id)
            ):
                usage[shop_id][ingredient_id] = total
            shop_query = select(models.Shop).order_by(models.Shop.id)
            if self.single_shop:
                shop_query = (
                    select(models.Shop)
                    .where(models.Shop.category.in_(("bakery", "cafe", "juice_shop")))
                    .order_by(models.Shop.is_default.desc(), models.Shop.id)
                    .limit(1)
                )
            shops = tuple(
                ShopInputs(shop.id, shop.category, usage.get(shop.id, {}))
                for shop in session.scalars(shop_query)
            )
            offers = tuple(
                Offer(
                    listing.id,
                    listing.ingredient_id,
                    listing.seller_id,
                    seller_name,
                    listing.price_per_kg_thb,
                    listing.stock_kg,
                    listing.active,
                )
                for listing, seller_name in session.execute(
                    select(models.Listing, models.Seller.name)
                    .join(models.Seller, models.Seller.id == models.Listing.seller_id)
                    .order_by(models.Listing.id)
                )
            )
            observations = tuple(
                Observation(slug, day, len({source["url"] for source in sources}))
                for slug, day, sources in session.execute(
                    select(
                        models.DailyTrend.slug,
                        models.DailyRun.trend_date,
                        models.DailyTrend.sources,
                    )
                    .join(
                        models.DailyRun, models.DailyRun.id == models.DailyTrend.run_id
                    )
                    .where(
                        models.DailyRun.trend_date >= first_day,
                        models.DailyRun.trend_date < trend_date,
                    )
                )
            )
        return JobInputs(catalog, shops, offers, observations)

    def publish(self, attempt: JobAttempt, snapshot: Snapshot) -> JobAttempt:
        publication = snapshot.publication
        with Session(self.engine) as session, session.begin():
            row = _running(session, attempt)
            session.execute(
                delete(models.DailyRun).where(
                    models.DailyRun.trend_date == publication.trend_date
                )
            )
            session.add(
                models.DailyRun(
                    id=publication.id,
                    trend_date=publication.trend_date,
                    started_at=publication.started_at,
                    finished_at=publication.finished_at,
                    status=publication.status,
                    source=publication.source,
                )
            )
            session.flush()
            self._save_trends(session, snapshot)
            self._save_enrichment(session, snapshot)
            if self.notify:
                names = {entry.trend.slug: entry.trend.name_en for entry in snapshot.trends}
                publish_daily_notifications(
                    session, publication.trend_date,
                    {shop_id: names[trends[0].slug]
                     for shop_id, trends in snapshot.recommendations.items() if trends},
                    created_at=publication.finished_at,
                )

            row.state = "published"
            row.finished_at = publication.finished_at
            row.publication_id = publication.id
            return _attempt(row)

    @staticmethod
    def _save_trends(session: Session, snapshot: Snapshot) -> None:
        for entry in snapshot.trends:
            trend = entry.trend
            session.add(
                models.DailyTrend(
                    run_id=snapshot.publication.id,
                    slug=trend.slug,
                    name_en=trend.name_en,
                    name_th=trend.name_th,
                    kind=trend.kind,
                    momentum=entry.momentum,
                    is_new=entry.is_new,
                    why_rising_en=trend.why_rising_en,
                    why_rising_th=trend.why_rising_th,
                    image_key=trend.image_key,
                    score=entry.score,
                    sources=[
                        {
                            "url": source.url,
                            "title": source.title,
                            **(
                                {"published_at": source.published_at.isoformat()}
                                if source.published_at
                                else {}
                            ),
                        }
                        for source in trend.sources
                    ],
                )
            )
        session.flush()

    @staticmethod
    def _save_enrichment(session: Session, snapshot: Snapshot) -> None:
        run_id = snapshot.publication.id
        matched_ids = {
            match.ingredient_id
            for matches in snapshot.ingredients.values()
            for match in matches
            if match.ingredient_id is not None
        }
        names = (
            {
                ingredient.id: (ingredient.name_en, ingredient.name_th)
                for ingredient in session.scalars(
                    select(models.Ingredient).where(
                        models.Ingredient.id.in_(matched_ids)
                    )
                )
            }
            if matched_ids
            else {}
        )
        session.add_all(
            models.TrendIngredient(
                run_id=run_id,
                trend_slug=slug,
                position=position,
                name_en=names[match.ingredient_id][0]
                if match.ingredient_id
                else match.name,
                name_th=names[match.ingredient_id][1]
                if match.ingredient_id
                else (match.name_th or match.name),
                ingredient_id=match.ingredient_id,
            )
            for slug, matches in snapshot.ingredients.items()
            for position, match in enumerate(matches)
        )
        session.add_all(
            models.CategoryInsight(
                run_id=run_id,
                trend_slug=slug,
                category=category,
                fit=Decimal(str(insight.fit)),
                why_fit_en=insight.why_fit_en,
                why_fit_th=insight.why_fit_th,
                menu_idea_en=insight.menu_idea_en,
                menu_idea_th=insight.menu_idea_th,
                priority_ingredient_ids=list(insight.priority_ingredient_ids),
            )
            for category, insights in snapshot.categories.items()
            for slug, insight in insights.items()
        )
        session.add_all(
            models.DailyRecommendation(
                run_id=run_id,
                shop_id=shop_id,
                trend_slug=trend.slug,
                position=position,
                ingredients=[
                    {
                        "ingredient_id": item.ingredient_id,
                        "score": str(item.score),
                        "suggested_kg": item.suggested_kg,
                        "explanation": item.explanation,
                        "listings": [
                            {
                                "id": offer.id,
                                "seller_id": offer.seller_id,
                                "seller_name": offer.seller_name,
                                "price_per_kg_thb": f"{offer.price_per_kg_thb:.2f}",
                                "stock_kg": offer.stock_kg,
                            }
                            for offer in item.listings
                        ],
                    }
                    for item in trend.ingredients
                ],
            )
            for shop_id, trends in snapshot.recommendations.items()
            for position, trend in enumerate(trends)
        )

    def fail(self, attempt: JobAttempt, now: datetime, error: str) -> JobAttempt:
        with Session(self.engine) as session, session.begin():
            row = session.scalar(
                select(models.DailyJobAttempt)
                .where(models.DailyJobAttempt.id == attempt.id)
                .with_for_update()
            )
            if row is None:
                raise RuntimeError("Daily trend attempt no longer exists.")
            if row.state == "running":
                row.state = "error"
                row.finished_at = max(row.started_at, now)
                row.error = error
            return _attempt(row)
