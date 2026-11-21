from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, TypeAdapter
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from . import models
from .catalog import IngredientListingResponse, Money, ingredient_listings

Locale = Literal["th", "en"]


class ReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class DailyShop(ReadModel):
    id: str
    name: str
    category: str


class ShopList(BaseModel):
    shops: tuple[DailyShop, ...]
    default_shop_id: str | None


class Run(ReadModel):
    id: str
    trend_date: date
    started_at: datetime
    finished_at: datetime
    status: str
    source: str


class Source(BaseModel):
    url: str
    title: str
    published_at: date | None = None


class Listing(BaseModel):
    id: str
    seller_id: str
    seller_name: str
    price_per_kg_thb: Money
    stock_kg: int


class Ingredient(BaseModel):
    name: str
    ingredient_id: str | None
    suggested_kg: int
    availability: Literal["available", "unavailable"]
    listings: tuple[Listing, ...] = ()


class Trend(BaseModel):
    slug: str
    name: str
    kind: str
    momentum: str
    is_new: bool
    why_rising: str
    why_fit: str
    menu_idea: str
    image_key: str | None
    sources: tuple[Source, ...]
    ingredients: tuple[Ingredient, ...]


class SharedToday(BaseModel):
    run: Run | None
    trends: tuple[Trend, ...]


class ShopToday(SharedToday):
    shop: DailyShop


class SavedRecommendation(BaseModel):
    ingredient_id: str
    suggested_kg: int
    listings: tuple[Listing, ...]


RECOMMENDATIONS = TypeAdapter(list[SavedRecommendation])


def _text(en: str, th: str, locale: Locale) -> str:
    return (th or en) if locale == "th" else (en or th)


class SavedReads(Protocol):
    def shops(self) -> ShopList: ...
    def today(self, shop_id: str, locale: Locale) -> ShopToday | None: ...
    def trends(self, locale: Locale) -> SharedToday: ...
    def listings(
        self, ingredient_id: str | None, query: str | None, category: str | None
    ) -> tuple[IngredientListingResponse, ...]: ...


class DailyReadRepository:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def shops(self) -> ShopList:
        with Session(self.engine) as session:
            rows = list(
                session.scalars(
                    select(models.Shop).order_by(
                        models.Shop.is_default.desc(), models.Shop.id
                    )
                )
            )
            return ShopList(
                shops=tuple(DailyShop.model_validate(row) for row in rows),
                default_shop_id=rows[0].id if rows else None,
            )

    def today(self, shop_id: str, locale: Locale) -> ShopToday | None:
        with (
            self.engine.connect().execution_options(
                isolation_level="REPEATABLE READ"
            ) as connection,
            Session(connection) as session,
        ):
            shop = session.get(models.Shop, shop_id)
            if shop is None:
                return None
            snapshot = self._snapshot(session, locale, shop)
            return ShopToday(
                shop=DailyShop.model_validate(shop), **snapshot.model_dump()
            )

    def trends(self, locale: Locale) -> SharedToday:
        with (
            self.engine.connect().execution_options(
                isolation_level="REPEATABLE READ"
            ) as connection,
            Session(connection) as session,
        ):
            return self._snapshot(session, locale)

    def listings(
        self, ingredient_id: str | None, query: str | None, category: str | None
    ) -> tuple[IngredientListingResponse, ...]:
        return ingredient_listings(self.engine, ingredient_id, query, category)

    @staticmethod
    def _snapshot(
        session: Session, locale: Locale, shop: models.Shop | None = None
    ) -> SharedToday:
        run = session.scalar(
            select(models.DailyRun)
            .where(models.DailyRun.status.in_(("ok", "fallback")))
            .order_by(
                models.DailyRun.trend_date.desc(), models.DailyRun.finished_at.desc()
            )
            .limit(1)
        )
        if run is None:
            return SharedToday(run=None, trends=())
        trends = {
            row.slug: row
            for row in session.scalars(
                select(models.DailyTrend)
                .where(models.DailyTrend.run_id == run.id)
                .order_by(models.DailyTrend.score.desc(), models.DailyTrend.slug)
            )
        }
        matches: dict[str, list[models.TrendIngredient]] = {slug: [] for slug in trends}
        for row in session.scalars(
            select(models.TrendIngredient)
            .where(models.TrendIngredient.run_id == run.id)
            .order_by(models.TrendIngredient.position)
        ):
            matches[row.trend_slug].append(row)

        insights: dict[str, models.CategoryInsight] = {}
        recommendations: dict[str, list[SavedRecommendation]] = {}
        if shop is not None:
            insights = {
                row.trend_slug: row
                for row in session.scalars(
                    select(models.CategoryInsight).where(
                        models.CategoryInsight.run_id == run.id,
                        models.CategoryInsight.category == shop.category,
                    )
                )
            }
            recommendations = {
                row.trend_slug: RECOMMENDATIONS.validate_python(row.ingredients)
                for row in session.scalars(
                    select(models.DailyRecommendation)
                    .where(
                        models.DailyRecommendation.run_id == run.id,
                        models.DailyRecommendation.shop_id == shop.id,
                    )
                    .order_by(models.DailyRecommendation.position)
                )
            }

        rendered = []
        for slug in recommendations if shop is not None else trends:
            trend = trends[slug]
            insight = insights.get(slug)
            ranked = recommendations.get(slug, [])
            ingredient_names = {
                match.ingredient_id: _text(match.name_en, match.name_th, locale)
                for match in matches[slug]
                if match.ingredient_id is not None
            }
            ingredients = [
                Ingredient(
                    name=ingredient_names.get(item.ingredient_id, item.ingredient_id),
                    ingredient_id=item.ingredient_id,
                    suggested_kg=item.suggested_kg,
                    availability="available"
                    if any(listing.stock_kg > 0 for listing in item.listings)
                    else "unavailable",
                    listings=item.listings,
                )
                for item in ranked
            ]
            ranked_ids = {item.ingredient_id for item in ranked}
            ingredients.extend(
                Ingredient(
                    name=_text(match.name_en, match.name_th, locale),
                    ingredient_id=match.ingredient_id,
                    suggested_kg=0,
                    availability="unavailable",
                )
                for match in matches[slug]
                if match.ingredient_id not in ranked_ids
            )
            rendered.append(
                Trend(
                    slug=slug,
                    name=_text(trend.name_en, trend.name_th, locale),
                    kind=trend.kind,
                    momentum=trend.momentum,
                    is_new=trend.is_new,
                    why_rising=_text(trend.why_rising_en, trend.why_rising_th, locale),
                    why_fit=_text(insight.why_fit_en, insight.why_fit_th, locale)
                    if insight
                    else "",
                    menu_idea=_text(insight.menu_idea_en, insight.menu_idea_th, locale)
                    if insight
                    else "",
                    image_key=trend.image_key,
                    sources=tuple(
                        Source.model_validate(source) for source in trend.sources
                    ),
                    ingredients=tuple(ingredients),
                )
            )
        return SharedToday(run=Run.model_validate(run), trends=tuple(rendered))


class ListingList(BaseModel):
    listings: tuple[IngredientListingResponse, ...]


def daily_read_router(store: SavedReads, job_status: Callable[[], object]) -> APIRouter:
    router = APIRouter()

    @router.get("/shops")
    def shops() -> ShopList:
        return store.shops()

    @router.get("/shops/{shop_id}/today")
    def today(shop_id: str, locale: Locale = "th") -> ShopToday:
        result = store.today(shop_id, locale)
        if result is None:
            raise HTTPException(
                404, detail={"code": "shop_not_found", "shop_id": shop_id}
            )
        return result

    @router.get("/trends/today")
    def trends(locale: Locale = "th") -> SharedToday:
        return store.trends(locale)

    @router.get("/jobs/daily-trend/latest")
    def latest() -> object:
        return job_status()

    @router.get("/listings")
    def listings(
        ingredient_id: str | None = None,
        q: Annotated[str | None, Query(max_length=100)] = None,
        category: str | None = None,
    ) -> ListingList:
        return ListingList(listings=store.listings(ingredient_id, q, category))

    return router
