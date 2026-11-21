import os
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import Engine

from backend.db.seeds.idea_a_marketplace import (
    SEED_CATEGORY_INSIGHTS,
    SEED_TREND_INGREDIENTS,
    SEED_TRENDS,
)

from .category_fit import CategoryInsight, CategoryMatcher
from .daily_discovery import DailyTrend, OpenAIDailyDiscovery
from .daily_job import DailyJob, Enrichment
from .daily_publication import SqlPublicationStore
from .ingredient_extraction import IngredientExtractor, IngredientMatch

TREND = TypeAdapter(DailyTrend)


def seed_enrichment() -> Enrichment:
    trends = tuple(
        TREND.validate_python({
            **row, "confidence": (float(cast(Decimal, row["score"])) - 0.08) / 0.6,
        })
        for row in SEED_TRENDS.values()
    )
    ingredients = {
        slug: tuple(
            IngredientMatch(name_en, ingredient_id, name_th)
            for ingredient_id, name_en, name_th in rows
        )
        for slug, rows in SEED_TREND_INGREDIENTS.items()
    }
    categories = {
        category: {
            slug: CategoryInsight(float(fit), why_en, why_th, menu_en, menu_th, priorities)
            for slug, (fit, why_en, why_th, menu_en, menu_th, priorities) in rows.items()
        }
        for category, rows in SEED_CATEGORY_INSIGHTS.items()
    }
    return Enrichment(trends, ingredients, categories)


def build_daily_job(engine: Engine, clock: Callable[[], datetime]) -> DailyJob:
    fixture = seed_enrichment()
    extract_seeds = {
        slug: tuple(match.name for match in matches)
        for slug, matches in fixture.ingredients.items()
    }
    use_seed = os.getenv("IDEA_A_USE_SEED_TRENDS", "").lower() in {"true", "1"}
    discover = None if use_seed else OpenAIDailyDiscovery.from_env()
    extract = IngredientExtractor(seeds=extract_seeds)
    match = CategoryMatcher(seeds=fixture.categories)
    if discover is not None:
        extract = IngredientExtractor.from_env(seeds=extract_seeds)
        match = CategoryMatcher.from_env(seeds=fixture.categories)

    return DailyJob(
        SqlPublicationStore(engine, seed_enrichment),
        discover or (lambda _day, _catalog: ()),
        extract,
        match,
        clock=clock,
        use_seed=discover is None,
    )
