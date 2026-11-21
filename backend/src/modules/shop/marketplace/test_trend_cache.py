from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Event

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from . import models, trend_cache
from .trend_cache import SqlTrendStore, TrendRunInfo, TrendService, TrendSnapshot
from .trend_provider import (
    TrendCard,
    TrendFruit,
    TrendProviderFailure,
    TrendRequest,
    TrendSource,
)
from .trend_router import trend_router

NOW = datetime(2026, 11, 21, 19, tzinfo=UTC)
CATALOG = (TrendFruit("mango", "Mango", "มะม่วง"),)
SOURCE = (TrendSource("https://example.com/mango", "Mango recipes"),)
LIVE = TrendCard(
    "mango",
    "Mango drinks",
    "Mango was featured.",
    ("Mango shake",),
    0.8,
    1,
    0.56,
    SOURCE,
)
SEED = TrendCard(
    "mango",
    "Mango sticky rice",
    "A local favorite.",
    ("Mango sticky rice",),
    0.7,
    1,
    0.5,
    SOURCE,
)


class MemoryStore:
    def __init__(self, seed: tuple[TrendCard, ...] = (SEED,)) -> None:
        self.seed = seed
        self.published: list[TrendSnapshot] = []

    @contextmanager
    def transaction(self) -> Iterator["MemoryStore"]:
        yield self

    def latest(self) -> TrendSnapshot:
        return next(
            (result for result in reversed(self.published) if result.cards),
            TrendSnapshot(),
        )

    def seed_cards(self) -> tuple[TrendCard, ...]:
        return self.seed

    def catalog(self) -> tuple[TrendFruit, ...]:
        return CATALOG

    def publish(self, run: TrendRunInfo, cards: tuple[TrendCard, ...]) -> None:
        self.published.append(TrendSnapshot(run, cards))


def test_refresh_reuses_fresh_run_and_latest_never_calls_provider():
    store = MemoryStore()
    times = [NOW]
    calls = []

    def provider(request: TrendRequest) -> tuple[TrendCard, ...]:
        calls.append(request)
        return (LIVE,)

    service = TrendService(
        store, provider, clock=lambda: times[0], cache_window=timedelta(hours=2)
    )
    assert service.latest() == TrendSnapshot()
    assert calls == []
    first = service.refresh()
    assert first.status == "ok"
    assert first.source == "live"
    assert calls[0].day.isoformat() == "2026-11-22"
    assert calls[0].catalog == CATALOG
    assert service.latest() == TrendSnapshot(first, (LIVE,))
    times[0] += timedelta(hours=1)
    assert service.refresh() == first
    times[0] += timedelta(hours=1)
    assert service.refresh().id != first.id
    assert len(calls) == 2


@pytest.mark.parametrize(
    "mode", ["seed", "missing_key", "timeout", "invalid_output", "empty"]
)
def test_refresh_falls_back_and_publishes_copy_of_seed(mode):
    store = MemoryStore()
    calls = []

    def provider(request: TrendRequest) -> tuple[TrendCard, ...]:
        calls.append(request)
        if mode == "timeout":
            raise TrendProviderFailure("timeout")
        if mode == "invalid_output":
            raise TrendProviderFailure("invalid_output")
        return ()

    service = TrendService(
        store,
        provider if mode != "missing_key" else None,
        clock=lambda: NOW,
        use_seed=mode == "seed",
    )
    run = service.refresh()
    assert (run.status, run.source) == ("fallback", "seed")
    assert service.latest() == TrendSnapshot(run, (SEED,))
    assert service.refresh() == run
    assert len(calls) == (0 if mode in {"seed", "missing_key"} else 1)


def test_error_without_seed_keeps_previous_usable_run():
    store = MemoryStore(seed=())
    old = TrendRunInfo("old", NOW, NOW, "ok", "live")
    store.publish(old, (LIVE,))
    service = TrendService(store, lambda _: (), clock=lambda: NOW + timedelta(days=2))
    assert service.refresh().status == "error"
    assert service.latest() == TrendSnapshot(old, (LIVE,))


def test_simultaneous_refreshes_share_in_flight_result_even_with_zero_cache(
    monkeypatch,
):
    waiting = Event()
    entered = Event()
    release = Event()

    class ObservedFuture(Future[TrendRunInfo]):
        def result(self, timeout=None):
            waiting.set()
            return super().result(timeout)

    monkeypatch.setattr(trend_cache, "Future", ObservedFuture)

    def provider(request):
        entered.set()
        assert release.wait(5)
        return (LIVE,)

    store = MemoryStore()
    service = TrendService(
        store, provider, clock=lambda: NOW, cache_window=timedelta(0)
    )
    with ThreadPoolExecutor(2) as executor:
        scheduled = executor.submit(service.refresh, NOW)
        assert entered.wait(5)
        manual = executor.submit(service.refresh)
        try:
            assert waiting.wait(5)
        finally:
            release.set()
        assert scheduled.result() == manual.result()
    assert len(store.published) == 1


def test_http_exposes_run_and_cited_cards():
    service = TrendService(MemoryStore(), None, clock=lambda: NOW)
    app = FastAPI()
    app.include_router(trend_router(service), prefix="/api/ideas/idea-a")
    with TestClient(app) as client:
        latest = "/api/ideas/idea-a/trends/latest"
        assert client.get(latest).json() == {"run": None, "cards": []}
        refresh = client.post("/api/ideas/idea-a/trends/run")
        assert refresh.status_code == 200
        assert refresh.json()["status"] == "fallback"
        payload = client.get(latest).json()
        assert payload["run"] == {
            "id": refresh.json()["run_id"],
            "started_at": "2026-11-21T19:00:00Z",
            "finished_at": "2026-11-21T19:00:00Z",
            "status": "fallback",
            "source": "seed",
        }
        assert payload["cards"][0]["sources"] == [asdict(SOURCE[0])]


def test_postgres_publishes_trends_and_leaves_saved_order_untouched(
    marketplace_engine: Engine,
):
    with Session(marketplace_engine) as session, session.begin():
        session.add(models.Shop(id="cafe", name="Café", category="cafe", menu_tags=[]))
        session.add(models.Fruit(id="mango", name_en="Mango", name_th="มะม่วง", tags=[]))
        session.flush()
        session.add(
            models.Order(
                id="saved-order",
                shop_id="cafe",
                idempotency_key="93839b60-c79e-4f96-b942-7d9ac00005e9",
                status="placed",
                total_thb=Decimal("390.00"),
                created_at=NOW,
            )
        )

    store = SqlTrendStore(marketplace_engine)
    service = TrendService(store, lambda _: (LIVE,), clock=lambda: NOW)
    run = service.refresh()
    assert store.latest() == TrendSnapshot(run, (LIVE,))
    with Session(marketplace_engine) as session:
        saved = session.scalars(select(models.Order)).one()
        assert (saved.id, saved.total_thb, saved.created_at) == (
            "saved-order",
            Decimal("390.00"),
            NOW,
        )
