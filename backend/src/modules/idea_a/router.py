from collections.abc import Callable
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import Engine

from backend.src.shared.records import records_router

from .marketplace.auth import DemoAuth, auth_router
from .marketplace.catalog import CatalogRepository, catalog_router
from .marketplace.checkout import OrderRepository, orders_router
from .marketplace.explanation_store import SqlExplanationStore
from .marketplace.feed import FeedService, feed_router
from .marketplace.feed_explanations import FeedExplanations, OpenAIFeedExplanations
from .marketplace.ranking import TrendSignal
from .marketplace.trend_cache import TrendService
from .marketplace.trend_router import trend_router


def marketplace_router(
    engine: Engine, trends: TrendService, clock: Callable[[], datetime],
) -> APIRouter:
    catalog = CatalogRepository(engine)
    explanations = FeedExplanations(
        OpenAIFeedExplanations.from_env(), SqlExplanationStore(engine),
    )

    def trend_signals() -> tuple[str | None, tuple[TrendSignal, ...]]:
        snapshot = trends.latest()
        return (
            snapshot.run.id if snapshot.run else None,
            tuple(
                TrendSignal(card.fruit_id, Decimal(str(card.score)), card.trend_name)
                for card in snapshot.cards
            ),
        )

    router = records_router(
        "SELECT id, title FROM idea_a_records ORDER BY id",
        "INSERT INTO idea_a_records (title) VALUES (%s) RETURNING id, title",
    )
    auth = DemoAuth.from_env()
    router.include_router(auth_router(auth))
    protected = APIRouter(dependencies=[Depends(auth.require_session)])
    protected.include_router(catalog_router(catalog))
    protected.include_router(trend_router(trends))
    protected.include_router(feed_router(FeedService(catalog, trend_signals, explanations, clock=clock)))
    protected.include_router(orders_router(OrderRepository(engine, clock=clock)))
    router.include_router(protected)
    return router
