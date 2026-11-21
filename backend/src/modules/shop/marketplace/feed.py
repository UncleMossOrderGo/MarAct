import hashlib
import json
from collections.abc import Callable, Iterator, Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Annotated, Protocol

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from ..planner import BANGKOK
from .catalog import FruitResponse, ListingResponse
from .feed_explanations import FeedExplanations, template
from .ranking import Listing, RankedFruit, Shop, TrendSignal, UsageTotal, rank


class Catalog(Protocol):
    def shop(self, shop_id: str) -> Shop | None: ...
    def listings(self, fruit_id: str | None = None) -> Sequence[Listing]: ...
    def usage_totals(
        self, shop_id: str, planning_date: date
    ) -> Sequence[UsageTotal]: ...


class FeedItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    fruit: FruitResponse
    score: float
    suggested_kg: int
    trend_name: str | None
    listings: list[ListingResponse]
    explanation: str
    explanation_source: str


class FeedResponse(BaseModel):
    feed_key: str
    run_id: str | None
    items: list[FeedItem]


@dataclass(frozen=True)
class FeedFacts:
    key: str
    run_id: str | None
    items: tuple[RankedFruit, ...]


class FeedService:
    def __init__(
        self,
        catalog: Catalog,
        trends: Callable[[], tuple[str | None, Sequence[TrendSignal]]],
        explanations: FeedExplanations,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
        scorer: Callable[
            [Shop, Sequence[UsageTotal], Sequence[Listing], Sequence[TrendSignal]],
            tuple[RankedFruit, ...],
        ] = rank,
    ) -> None:
        self.catalog = catalog
        self.trends = trends
        self.explanations = explanations
        self.clock = clock
        self.scorer = scorer

    def facts(self, shop_id: str) -> FeedFacts:
        shop = self.catalog.shop(shop_id)
        if shop is None:
            raise HTTPException(404, detail="Unknown shop.")
        run_id, signals = self.trends()
        day = self.clock().astimezone(BANGKOK).date()
        usage = sorted(
            self.catalog.usage_totals(shop_id, day), key=lambda row: row.fruit_id
        )
        items = self.scorer(shop, usage, self.catalog.listings(), signals)
        material = [
            asdict(shop),
            run_id,
            [asdict(row) for row in usage],
            [asdict(item) for item in items],
        ]
        encoded = json.dumps(
            material, default=str, sort_keys=True, separators=(",", ":")
        )
        key = hashlib.sha256(encoded.encode()).hexdigest()
        return FeedFacts(key, run_id, items)

    def read(self, shop_id: str, locale: str) -> FeedResponse:
        facts = self.facts(shop_id)
        cached = self.explanations.cached(facts.key, locale)
        return FeedResponse(
            feed_key=facts.key,
            run_id=facts.run_id,
            items=[
                FeedItem(
                    fruit=FruitResponse.model_validate(item.fruit),
                    score=float(item.score),
                    suggested_kg=item.suggested_kg,
                    trend_name=item.trend_name,
                    listings=[
                        ListingResponse.model_validate(offer) for offer in item.listings
                    ],
                    explanation=cached.get(item.fruit.id) or template(item),
                    explanation_source="ai" if item.fruit.id in cached else "template",
                )
                for item in facts.items
            ],
        )

    def stream(self, facts: FeedFacts, locale: str) -> Iterator[str]:
        explanations = self.explanations.generate(facts.key, locale, facts.items)
        for item in facts.items:
            text = explanations.get(item.fruit.id)
            if text:
                payload = json.dumps(
                    {
                        "fruit_id": item.fruit.id,
                        "explanation": text,
                        "explanation_source": "ai",
                    },
                    ensure_ascii=False,
                )
                yield f"event: explanation\ndata: {payload}\n\n"
        yield "event: done\ndata: {}\n\n"


Locale = Annotated[str, Query(pattern=r"^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$")]


def feed_router(service: FeedService) -> APIRouter:
    router = APIRouter()

    @router.get("/shops/{shop_id}/feed")
    def read_feed(shop_id: str, locale: Locale = "en") -> FeedResponse:
        return service.read(shop_id, locale.lower())

    @router.get("/shops/{shop_id}/feed/explanations")
    def stream_feed(
        shop_id: str, feed_key: str, locale: Locale = "en"
    ) -> StreamingResponse:
        facts = service.facts(shop_id)
        if facts.key != feed_key:
            raise HTTPException(
                409, detail="Feed changed. Reload it before requesting explanations."
            )
        return StreamingResponse(
            service.stream(facts, locale.lower()),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return router
