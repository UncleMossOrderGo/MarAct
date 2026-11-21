import os
from collections.abc import Callable, Iterator
from concurrent.futures import Future
from contextlib import AbstractContextManager, contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from threading import Lock
from typing import Literal, Protocol, cast
from uuid import uuid4

from sqlalchemy import Engine, exists, select, text
from sqlalchemy.orm import Session

from backend.db.seeds.idea_a_marketplace import SEED_TREND_RUN_ID

from ..planner import BANGKOK
from . import models
from .trend_provider import (
    OpenAITrendProvider,
    TrendCard,
    TrendFruit,
    TrendProviderFailure,
    TrendRequest,
    TrendSource,
)

RunStatus = Literal["ok", "fallback", "error"]
RunSource = Literal["live", "seed"]
TrendProvider = Callable[[TrendRequest], tuple[TrendCard, ...]]


@dataclass(frozen=True)
class TrendRunInfo:
    id: str
    started_at: datetime
    finished_at: datetime
    status: RunStatus
    source: RunSource


@dataclass(frozen=True)
class TrendSnapshot:
    run: TrendRunInfo | None = None
    cards: tuple[TrendCard, ...] = ()


class TrendTransaction(Protocol):
    def latest(self) -> TrendSnapshot: ...
    def seed_cards(self) -> tuple[TrendCard, ...]: ...
    def catalog(self) -> tuple[TrendFruit, ...]: ...
    def publish(self, run: TrendRunInfo, cards: tuple[TrendCard, ...]) -> None: ...


class TrendStore(Protocol):
    def latest(self) -> TrendSnapshot: ...
    def transaction(self) -> AbstractContextManager[TrendTransaction]: ...


class TrendService:
    def __init__(
        self,
        store: TrendStore,
        provider: TrendProvider | None,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
        cache_window: timedelta = timedelta(hours=24),
        use_seed: bool = False,
    ) -> None:
        if cache_window < timedelta(0):
            raise ValueError("Trend cache window must be nonnegative.")
        self.store = store
        self.provider = provider
        self.clock = clock
        self.cache_window = cache_window
        self.use_seed = use_seed
        self._lock = Lock()
        self._pending: Future[TrendRunInfo] | None = None

    @classmethod
    def from_env(
        cls,
        engine: Engine,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
    ) -> "TrendService":
        use_seed = os.getenv("IDEA_A_USE_SEED_TRENDS", "").strip().lower() in {
            "true",
            "1",
        }
        cache_window = timedelta(
            hours=float(os.getenv("IDEA_A_TREND_CACHE_HOURS", "24"))
        )
        return cls(
            SqlTrendStore(engine),
            OpenAITrendProvider.from_env() if not use_seed else None,
            clock=clock,
            cache_window=cache_window,
            use_seed=use_seed,
        )

    def latest(self) -> TrendSnapshot:
        return self.store.latest()

    def refresh(self, now: datetime | None = None) -> TrendRunInfo:
        started_at = now if now is not None else self.clock()
        with self._lock:
            pending = self._pending
            owner = pending is None
            if pending is None:
                pending = self._pending = Future()

        if not owner:
            return pending.result()
        try:
            run = self._refresh(started_at)
        except BaseException as exc:
            pending.set_exception(exc)
            raise
        else:
            pending.set_result(run)
            return run
        finally:
            with self._lock:
                self._pending = None

    def _refresh(self, started_at: datetime) -> TrendRunInfo:
        with self.store.transaction() as transaction:
            latest = transaction.latest().run
            seed_only = self.use_seed or self.provider is None
            if latest is not None and (not seed_only or latest.source == "seed"):
                # A refresh in another process may finish after this request arrived.
                age = started_at - latest.finished_at
                if age < self.cache_window:
                    return latest

            source: RunSource = "seed"
            status: RunStatus = "fallback"
            cards: tuple[TrendCard, ...] = ()
            if not self.use_seed and self.provider is not None:
                try:
                    cards = self.provider(
                        TrendRequest(
                            started_at.astimezone(BANGKOK).date(), transaction.catalog()
                        )
                    )
                except (TrendProviderFailure, TimeoutError):
                    pass
                if cards:
                    source, status = "live", "ok"

            if not cards:
                cards = transaction.seed_cards()
                if not cards:
                    status = "error"
                    source = "seed" if seed_only else "live"

            run = TrendRunInfo(
                str(uuid4()), started_at, max(started_at, self.clock()), status, source
            )
            transaction.publish(run, cards)
            return run


class SqlTrendStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def latest(self) -> TrendSnapshot:
        with Session(self.engine) as session:
            return _SqlTrendTransaction(session).latest()

    @contextmanager
    def transaction(self) -> Iterator[TrendTransaction]:
        with Session(self.engine) as session, session.begin():
            session.execute(text("SELECT pg_advisory_xact_lock(428911)"))
            yield _SqlTrendTransaction(session)


class _SqlTrendTransaction:
    def __init__(self, session: Session) -> None:
        self.session = session

    def latest(self) -> TrendSnapshot:
        run = self.session.scalar(
            select(models.TrendRun)
            .where(
                models.TrendRun.status.in_(("ok", "fallback")),
                exists().where(models.Trend.run_id == models.TrendRun.id),
            )
            .order_by(
                models.TrendRun.finished_at.desc(),
                models.TrendRun.started_at.desc(),
                models.TrendRun.id.desc(),
            )
            .limit(1)
        )
        if run is None:
            return TrendSnapshot()
        return TrendSnapshot(
            TrendRunInfo(
                run.id,
                run.started_at,
                run.finished_at,
                cast(RunStatus, run.status),
                cast(RunSource, run.source),
            ),
            self._cards(run.id),
        )

    def seed_cards(self) -> tuple[TrendCard, ...]:
        return self._cards(SEED_TREND_RUN_ID)

    def catalog(self) -> tuple[TrendFruit, ...]:
        fruits = self.session.scalars(select(models.Fruit).order_by(models.Fruit.id))
        return tuple(
            TrendFruit(fruit.id, fruit.name_en, fruit.name_th) for fruit in fruits
        )

    def publish(self, run: TrendRunInfo, cards: tuple[TrendCard, ...]) -> None:
        self.session.add(models.TrendRun(**asdict(run)))
        self.session.flush()
        self.session.add_all(
            models.Trend(
                run_id=run.id,
                fruit_id=card.fruit_id,
                trend_name=card.trend_name,
                rationale=card.rationale,
                related_menus=list(card.related_menus),
                confidence=Decimal(str(card.confidence)),
                mention_count=card.mention_count,
                score=Decimal(str(card.score)),
                sources=[asdict(source) for source in card.sources],
            )
            for card in cards
        )

    def _cards(self, run_id: str) -> tuple[TrendCard, ...]:
        rows = self.session.scalars(
            select(models.Trend)
            .where(models.Trend.run_id == run_id)
            .order_by(models.Trend.score.desc(), models.Trend.fruit_id)
        )
        return tuple(
            TrendCard(
                row.fruit_id,
                row.trend_name,
                row.rationale,
                tuple(row.related_menus),
                float(row.confidence),
                row.mention_count,
                float(row.score),
                tuple(
                    TrendSource(source["url"], source["title"])
                    for source in row.sources
                ),
            )
            for row in rows
        )
