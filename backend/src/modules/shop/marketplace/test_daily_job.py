from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from threading import Event
from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from ..planner import BANGKOK
from . import models
from .category_fit import CategoryInsight
from .daily_discovery import DailyDiscoveryFailure, DailySource, DailyTrend
from .daily_job import DailyJob, Enrichment, Snapshot
from .daily_publication import SqlPublicationStore
from .ingredient_extraction import IngredientMatch

NOW = datetime(2026, 11, 21, 6, tzinfo=BANGKOK)
TREND = DailyTrend(
    "pistachio-gelato",
    "Pistachio Gelato",
    "เจลาโตพิสตาชิโอ",
    "dessert",
    "rising",
    "Thai cafés are showcasing it.",
    "คาเฟ่ไทยกำลังนำเสนอเมนูนี้",
    0.9,
    (DailySource("https://example.com/gelato", "Gelato", NOW.date()),),
)
MATCHES = {
    TREND.slug: (
        IngredientMatch("Pistachio paste", "paste"),
        IngredientMatch("Kataifi", None),
    )
}
INSIGHT = CategoryInsight(
    0.8, "Works in a cake.", "เหมาะกับเค้ก", "Gelato cake", "เค้กเจลาโต", ("paste",)
)
SEED = Enrichment((TREND,), MATCHES, {"bakery": {TREND.slug: INSIGHT}})


def seed_catalog(engine: Engine) -> None:
    with Session(engine) as session, session.begin():
        session.add(
            models.Shop(id="bakery", name="Bakery", category="bakery", menu_tags=[])
        )
        session.add(models.Shop(id="cafe", name="Café", category="cafe", menu_tags=[]))
        session.add(
            models.Ingredient(
                id="paste", name_en="Pistachio paste", name_th="พิสตาชิโอ", tags=[]
            )
        )
        session.add(
            models.Seller(id="seller", name="Seller", area="Bangkok", rating=Decimal(5))
        )
        session.flush()
        session.add(
            models.Listing(
                id="paste-seller",
                seller_id="seller",
                fruit_id="paste",
                price_per_kg_thb=Decimal(820),
                stock_kg=25,
                active=True,
            )
        )


def test_live_job_publishes_one_complete_snapshot_with_partial_insights(
    daily_marketplace_engine: Engine,
) -> None:
    engine = daily_marketplace_engine
    seed_catalog(engine)
    calls = []

    def discover(day, catalog):
        calls.append("discovery")
        assert day == NOW.date()
        assert [item.id for item in catalog] == ["paste"]
        return (TREND,)

    def extract(trends, catalog):
        calls.append("extraction")
        return MATCHES

    def match(category, trends, ingredients):
        calls.append(category)
        return {TREND.slug: INSIGHT} if category == "bakery" else {}

    store = SqlPublicationStore(engine, lambda: SEED)
    job = DailyJob(store, discover, extract, match, clock=lambda: NOW)
    attempt = job.run()
    assert calls == ["discovery", "extraction", "bakery", "cafe"]
    assert attempt.state == "published"
    assert job.latest().attempt == attempt
    latest = job.latest().publication
    assert latest is not None and latest.source == "live"

    with Session(engine) as session:
        rows = session.scalars(select(models.TrendIngredient)).all()
        assert {row.ingredient_id for row in rows} == {"paste", None}
        saved = session.scalars(select(models.DailyRecommendation)).one()
        assert saved.shop_id == "bakery"
        assert saved.ingredients[0]["suggested_kg"] == 2
        assert saved.ingredients[0]["listings"] == [
            {
                "id": "paste-seller",
                "seller_id": "seller",
                "seller_name": "Seller",
                "price_per_kg_thb": "820.00",
                "stock_kg": 25,
            }
        ]
    job.close()


def test_failed_discovery_uses_seed_and_coalesces_across_workers(
    daily_marketplace_engine: Engine,
) -> None:
    engine = daily_marketplace_engine
    seed_catalog(engine)
    started, release = Event(), Event()

    def failed_discovery(day, catalog):
        started.set()
        assert release.wait(3)
        raise DailyDiscoveryFailure("timeout")

    def unexpected(*args):
        raise AssertionError("Seed fallback must not invoke the enrichment adapters")

    store = SqlPublicationStore(engine, lambda: SEED)
    worker = DailyJob(
        store, failed_discovery, unexpected, unexpected, clock=lambda: NOW
    )
    duplicate = DailyJob(
        store, failed_discovery, unexpected, unexpected, clock=lambda: NOW
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            finished = pool.submit(worker.run)
            assert started.wait(3)
            other = duplicate.trigger()
            assert other.state == "running"
            assert worker.latest().attempt == other
        finally:
            release.set()
        assert finished.result().id == other.id
    published = worker.latest().publication
    assert published is not None and published.status == "fallback"
    worker.close()
    duplicate.close()


def test_terminal_failure_and_failed_replacement_preserve_previous_snapshot(
    daily_marketplace_engine: Engine,
) -> None:
    engine = daily_marketplace_engine
    seed_catalog(engine)

    class BrokenStore(SqlPublicationStore):
        @staticmethod
        def _save_enrichment(session: Session, snapshot: Snapshot) -> None:
            raise RuntimeError("Publication transaction interrupted")

    def empty(*args):
        return ()

    store = SqlPublicationStore(engine, lambda: SEED)
    broken = BrokenStore(engine, lambda: SEED)
    no_seed = SqlPublicationStore(engine, lambda: Enrichment((), {}, {}))
    jobs = [
        DailyJob(item, empty, empty, empty, clock=lambda: NOW)
        for item in (store, broken, no_seed)
    ]
    assert jobs[0].run().state == "published"
    first = store.latest().publication
    assert first is not None
    with Session(engine) as session, session.begin():
        session.add(
            models.Order(
                id="saved-order",
                shop_id="bakery",
                idempotency_key=str(uuid4()),
                status="confirmed",
                total_thb=Decimal(1640),
                created_at=NOW,
            )
        )
        session.flush()
        session.add(
            models.OrderItem(
                order_id="saved-order",
                listing_id="paste-seller",
                fruit_id="paste",
                trend_slug=TREND.slug,
                trend_label=TREND.name_en,
                fruit_name="Pistachio paste",
                seller_name="Seller",
                qty_kg=2,
                price_per_kg_thb=Decimal(820),
                line_total_thb=Decimal(1640),
            )
        )

    assert jobs[1].run().error == "publication_failed"
    terminal = jobs[2].run()
    assert terminal.error == "no_usable_trends"
    assert store.latest().attempt == terminal
    assert store.latest().publication == first
    with Session(engine) as session:
        assert session.scalars(select(models.DailyTrend.slug)).all() == [TREND.slug]

    replacement = jobs[0].run()
    assert replacement.state == "published"
    assert replacement.publication_id != first.id
    assert store.latest().attempt == replacement
    with Session(engine) as session:
        assert session.scalars(select(models.DailyRun.id)).all() == [
            replacement.publication_id
        ]
    for job in jobs:
        job.close()
