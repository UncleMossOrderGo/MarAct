from datetime import UTC, datetime
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from . import models
from .daily_reads import DailyReadRepository, daily_read_router

SAVED_AT = datetime(2026, 11, 20, 23, 5, tzinfo=UTC)


def test_saved_reads_localize_and_filter_without_running_the_job(
    marketplace_engine: Engine,
):
    with Session(marketplace_engine) as session, session.begin():
        session.add_all(
            [
                models.Shop(
                    id="bakery",
                    name="MarAct Bakery",
                    category="bakery",
                    menu_tags=[],
                    is_default=True,
                ),
                models.Shop(
                    id="juice", name="Juice Shop", category="juice_shop", menu_tags=[]
                ),
                models.Ingredient(
                    id="pistachio",
                    name_en="Pistachio Paste",
                    name_th="พิสตาชิโอ",
                    aliases=["Pistachio Butter"],
                    tags=[],
                    category="nuts",
                    unit="kg",
                ),
                models.Seller(
                    id="seller", name="Bakery Supply", area="Bangkok", rating=Decimal(5)
                ),
            ]
        )
        session.flush()
        session.add(
            models.Listing(
                id="paste",
                seller_id="seller",
                ingredient_id="pistachio",
                price_per_kg_thb=Decimal(820),
                stock_kg=25,
                active=True,
            )
        )
    store = DailyReadRepository(marketplace_engine)
    app = FastAPI()
    status_reads = []

    def job_status():
        status_reads.append(True)
        return {"attempt": None}

    app.include_router(daily_read_router(store, job_status))
    client = TestClient(app)
    assert client.get("/shops").json()["default_shop_id"] == "bakery"
    assert client.get("/shops/bakery/today").json()["run"] is None
    assert client.get("/shops/missing/today").status_code == 404

    with Session(marketplace_engine) as session, session.begin():
        session.add(
            models.DailyRun(
                id="saved",
                trend_date=SAVED_AT.date(),
                status="fallback",
                source="seed",
                started_at=SAVED_AT,
                finished_at=SAVED_AT,
            )
        )
        session.flush()
        session.add(
            models.DailyTrend(
                run_id="saved",
                slug="gelato",
                name_en="Pistachio Gelato",
                name_th="เจลาโต",
                kind="dessert",
                momentum="rising",
                is_new=True,
                why_rising_en="On Thai menus",
                why_rising_th="ในเมนูไทย",
                image_key="gelato",
                score=Decimal("0.8"),
                sources=[
                    {
                        "url": "https://example.com/gelato",
                        "title": "Menu",
                        "published_at": "2026-11-19",
                    }
                ],
            )
        )
        session.flush()
        session.add_all(
            [
                models.TrendIngredient(
                    run_id="saved",
                    trend_slug="gelato",
                    position=0,
                    name_en="Pistachio Paste",
                    name_th="พิสตาชิโอ",
                    ingredient_id="pistachio",
                ),
                models.TrendIngredient(
                    run_id="saved",
                    trend_slug="gelato",
                    position=1,
                    name_en="Kataifi topping",
                    name_th="",
                    ingredient_id=None,
                ),
                models.CategoryInsight(
                    run_id="saved",
                    trend_slug="gelato",
                    category="bakery",
                    fit=Decimal("0.9"),
                    why_fit_en="Fits cakes",
                    why_fit_th="เหมาะกับเค้ก",
                    menu_idea_en="Gelato Cake",
                    menu_idea_th="เค้กเจลาโต",
                    priority_ingredient_ids=["pistachio"],
                ),
                models.DailyRecommendation(
                    run_id="saved",
                    trend_slug="gelato",
                    shop_id="bakery",
                    position=0,
                    ingredients=[
                        {
                            "ingredient_id": "pistachio",
                            "suggested_kg": 2,
                            "listings": [
                                {
                                    "id": "paste",
                                    "seller_id": "seller",
                                    "seller_name": "Bakery Supply",
                                    "price_per_kg_thb": "820.00",
                                    "stock_kg": 25,
                                }
                            ],
                        }
                    ],
                ),
            ]
        )

    english = client.get("/shops/bakery/today?locale=en").json()
    thai = client.get("/shops/bakery/today?locale=th").json()
    assert english["run"]["trend_date"] == "2026-11-20"
    assert english["run"]["finished_at"] == "2026-11-20T23:05:00Z"
    assert english["trends"][0]["menu_idea"] == "Gelato Cake"
    assert thai["trends"][0]["name"] == "เจลาโต"
    assert thai["trends"][0]["ingredients"][1]["ingredient_id"] is None
    assert english["trends"][0]["ingredients"][0]["suggested_kg"] == 2
    assert client.get("/shops/juice/today").json()["trends"] == []
    assert len(client.get("/trends/today").json()["trends"]) == 1

    found = client.get(
        "/listings", params={"q": "  PISTACHIO   butter ", "category": "nuts"}
    ).json()
    assert found["listings"][0]["price_per_kg_thb"] == "820.00"
    assert found["listings"][0]["name_th"] == "พิสตาชิโอ"
    assert client.get(
        "/listings", params={"q": "พิสตาชิโอ", "category": "dairy"}
    ).json() == {"listings": []}
    assert client.get("/listings?ingredient_id=missing").status_code == 404
    assert status_reads == []
    assert client.get("/jobs/daily-trend/latest").json() == {"attempt": None}
    assert status_reads == [True]
