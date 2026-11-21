"""Evaluate one ingredient trial against current Bangkok supplier terms."""

from collections.abc import Callable
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Connection, Engine, text

from ..scheduler import BANGKOK
from .trial_brief import Brief, TrialLimits, read_brief


class Trial(BaseModel):
    trend: str = Field(min_length=1, max_length=100)
    ingredient: str = Field(min_length=1, max_length=100)
    qty: int = Field(ge=1, le=500, strict=True)
    budget: Decimal = Field(gt=0, le=1000000, decimal_places=2)
    needed_by: date


class Match(Trial):
    id: UUID
    match_ms: int = Field(ge=0, le=2147483647)


class Quote(Trial):
    id: UUID
    listing_id: str
    match_ms: int = Field(ge=0, le=2147483647)
    expected_total: Decimal


class Supply(BaseModel):
    price_per_kg_thb: Decimal = Field(ge=0, le=1000000, decimal_places=2)
    stock_kg: int = Field(ge=0, le=100000, strict=True)
    min_kg: int = Field(ge=1, le=500, strict=True)
    shipping_thb: Decimal = Field(ge=0, le=100000, decimal_places=2)
    lead_days: int = Field(ge=0, le=30, strict=True)


def compare(
    conn: Connection, shop: str, trial: Trial, now: datetime, *, lock: bool = False
) -> list[dict]:
    query = """
      SELECT l.id AS listing_id, f.id AS ingredient_id, f.category, f.name_en, f.name_th, l.active, l.stock_kg, l.price_per_kg_thb, s.id AS seller_id,
             s.name AS supplier, s.area, t.min_kg, t.shipping_thb, t.lead_days, t.confirmed_at
      FROM idea_a_listings l JOIN idea_a_sellers s ON s.id=l.seller_id
      JOIN idea_a_fruits f ON f.id=l.fruit_id
      JOIN idea_a_trial_terms t ON t.listing_id=l.id
      WHERE (l.fruit_id=:ingredient OR :ingredient='auto') AND EXISTS (
        SELECT 1 FROM idea_a_daily_trend_ingredients i
        JOIN idea_a_daily_category_insights c ON c.run_id=i.run_id AND c.trend_slug=i.trend_slug
        JOIN idea_a_shops b ON b.category=c.category
        WHERE b.id=:shop AND i.trend_slug=:trend AND i.ingredient_id=l.fruit_id
          AND i.run_id=(SELECT id FROM idea_a_daily_runs ORDER BY trend_date DESC LIMIT 1))
      ORDER BY l.id
    """
    today = now.astimezone(BANGKOK).date()
    rows = conn.execute(
        text(query + (" FOR SHARE OF l,t" if lock else "")),
        {"ingredient": trial.ingredient, "shop": shop, "trend": trial.trend},
    )
    lots = []
    for record in rows.mappings():
        lot = dict(record)
        total = trial.qty * lot["price_per_kg_thb"] + lot["shipping_thb"]
        arrival = today + timedelta(days=lot["lead_days"])
        reasons = []
        if not lot["active"] or lot["stock_kg"] < trial.qty:
            reasons.append("stock")
        if lot["min_kg"] > trial.qty:
            reasons.append("minimum")
        if lot["confirmed_at"] < now - timedelta(days=3):
            reasons.append("stale")
        if arrival > trial.needed_by:
            reasons.append("late")
        if total > trial.budget:
            reasons.append("budget")
        lots.append({**lot, "total": total, "arrival": arrival, "reasons": reasons})
    ranked = sorted(
        lots,
        key=lambda lot: (
            lot["category"] != "fruit",
            bool(lot["reasons"]),
            lot["total"],
            lot["arrival"],
            lot["listing_id"],
        ),
    )
    if trial.ingredient == "auto" and ranked:
        return [
            lot for lot in ranked if lot["ingredient_id"] == ranked[0]["ingredient_id"]
        ]
    return ranked


def trial_router(engine: Engine, clock: Callable[[], datetime]) -> APIRouter:
    router = APIRouter()

    @router.post("/shops/{shop}/trial-brief")
    def interpret(shop: str, brief: Brief) -> TrialLimits:
        with engine.connect() as conn:
            if not conn.execute(
                text("SELECT 1 FROM idea_a_shops WHERE id=:shop"), {"shop": shop}
            ).scalar():
                raise HTTPException(404, "Shop unavailable.")
        return read_brief(brief.message, clock().astimezone(BANGKOK).date())

    @router.get("/shops/{shop}/trial-lots")
    def lots(
        shop: str,
        trend: Annotated[str, Query(min_length=1, max_length=100)],
        ingredient: Annotated[str, Query(min_length=1, max_length=100)],
        qty: Annotated[int, Query(ge=1, le=500)],
        budget: Annotated[Decimal, Query(gt=0, le=1000000, decimal_places=2)],
        needed_by: date,
    ) -> list[dict]:
        with engine.connect() as conn:
            return compare(
                conn,
                shop,
                Trial(
                    trend=trend,
                    ingredient=ingredient,
                    qty=qty,
                    budget=budget,
                    needed_by=needed_by,
                ),
                clock(),
            )

    @router.post("/shops/{shop}/trial-matches")
    def record_match(shop: str, body: Match) -> dict:
        with engine.begin() as conn:
            now = clock()
            if any(not lot["reasons"] for lot in compare(conn, shop, body, now)):
                conn.execute(
                    text("""INSERT INTO idea_a_trial_matches VALUES (:id,:shop,:trend,:ms,:now)
                    ON CONFLICT (id) DO NOTHING"""),
                    {
                        "id": body.id,
                        "shop": shop,
                        "trend": body.trend,
                        "ms": body.match_ms,
                        "now": now,
                    },
                )
        return {"id": body.id}

    @router.get("/shops/{shop}/trial-activity")
    def activity(shop: str) -> dict:
        with engine.connect() as conn:
            return dict(
                conn.execute(
                    text("""SELECT count(*) AS matches,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY match_ms) AS median_ms,
                (SELECT count(*) FROM idea_a_trial_quotes WHERE shop_id=:shop) AS quotes
                FROM idea_a_trial_matches WHERE shop_id=:shop"""),
                    {"shop": shop},
                )
                .mappings()
                .one()
            )

    @router.post("/shops/{shop}/trial-quotes")
    def quote(shop: str, body: Quote) -> dict:
        with engine.begin() as conn:
            params = {**body.model_dump(), "shop": shop, "now": clock()}
            # Serialize retries before inspecting the saved snapshot.
            conn.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                {"key": str(body.id)},
            )
            saved = (
                conn.execute(
                    text("SELECT * FROM idea_a_trial_quotes WHERE id=:id"), params
                )
                .mappings()
                .first()
            )
            if saved:
                if (
                    saved["shop_id"],
                    saved["listing_id"],
                    saved["trend_slug"],
                    saved["qty_kg"],
                    saved["budget_thb"],
                    saved["needed_by"],
                ) != (
                    shop,
                    body.listing_id,
                    body.trend,
                    body.qty,
                    body.budget,
                    body.needed_by,
                ):
                    raise HTTPException(409, "Quote request already used.")
                return {"id": body.id}
            options = compare(conn, shop, body, clock(), lock=True)
            lot = next((o for o in options if o["listing_id"] == body.listing_id), None)
            if not lot or lot["reasons"] or lot["total"] != body.expected_total:
                raise HTTPException(409, "Supplier terms changed.")
            conn.execute(
                text("""INSERT INTO idea_a_trial_quotes
              (id,shop_id,seller_id,listing_id,trend_slug,qty_kg,budget_thb,needed_by,delivered_thb,arrival,match_ms,created_at)
              VALUES (:id,:shop,:seller_id,:listing_id,:trend,:qty,:budget,:needed_by,:total,:arrival,:match_ms,:now)"""),
                {**params, **lot},
            )
            return {"id": body.id}

    @router.get("/sellers/{seller}/trials")
    def supplier(seller: str) -> dict:
        with engine.connect() as conn:
            listings = conn.execute(
                text("""SELECT l.id, f.name_en, f.name_th, l.stock_kg, l.price_per_kg_thb, t.* FROM idea_a_listings l
                JOIN idea_a_fruits f ON f.id=l.fruit_id JOIN idea_a_trial_terms t ON t.listing_id=l.id
                WHERE l.seller_id=:seller ORDER BY f.name_en"""),
                {"seller": seller},
            ).mappings()
            quotes = conn.execute(
                text("""SELECT q.*, b.name AS shop, f.name_en, f.name_th FROM idea_a_trial_quotes q
                JOIN idea_a_shops b ON b.id=q.shop_id JOIN idea_a_listings l ON l.id=q.listing_id
                JOIN idea_a_fruits f ON f.id=l.fruit_id WHERE q.seller_id=:seller ORDER BY q.created_at DESC"""),
                {"seller": seller},
            ).mappings()
            return {
                "listings": [dict(row) for row in listings],
                "quotes": [dict(row) for row in quotes],
            }

    @router.put("/sellers/{seller}/trial-lots/{listing}")
    def update(seller: str, listing: str, body: Supply) -> dict:
        with engine.begin() as conn:
            params = {
                **body.model_dump(),
                "listing": listing,
                "seller": seller,
                "now": clock(),
            }
            found = conn.execute(
                text("""UPDATE idea_a_listings SET stock_kg=:stock_kg, price_per_kg_thb=:price_per_kg_thb
                WHERE id=:listing AND seller_id=:seller RETURNING id"""),
                params,
            ).scalar()
            if not found:
                raise HTTPException(404, "Listing unavailable.")
            conn.execute(
                text("""INSERT INTO idea_a_trial_terms VALUES (:listing,:min_kg,:shipping_thb,:lead_days,:now)
                ON CONFLICT (listing_id) DO UPDATE SET min_kg=excluded.min_kg,shipping_thb=excluded.shipping_thb,
                lead_days=excluded.lead_days,confirmed_at=excluded.confirmed_at"""),
                params,
            )
            return {"id": listing}

    return router
