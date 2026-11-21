from datetime import date, timedelta
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from . import models
from .catalog import CatalogRepository, catalog_router
from .ranking import UsageTotal


def test_catalog_reads_current_listings_and_shop_scoped_history(
    marketplace_engine: Engine,
):
    today = date(2026, 11, 21)
    with Session(marketplace_engine) as session, session.begin():
        session.add_all(
            [
                models.Shop(
                    id="bakery", name="Bakery", category="bakery", menu_tags=["pastry"]
                ),
                models.Shop(
                    id="smoothies",
                    name="Smoothie Café",
                    category="cafe",
                    menu_tags=["smoothie"],
                ),
                models.Fruit(
                    id="mango", name_en="Mango", name_th="มะม่วง", tags=["tropical"]
                ),
                models.Fruit(
                    id="pineapple", name_en="Pineapple", name_th="สับปะรด", tags=[]
                ),
                models.Seller(
                    id="one", name="One", area="Bangkok", rating=Decimal("4.5")
                ),
                models.Seller(
                    id="two", name="Two", area="Bangkok", rating=Decimal("4.8")
                ),
            ]
        )
        session.flush()
        session.add_all(
            [
                models.Listing(
                    id="b",
                    fruit_id="mango",
                    seller_id="one",
                    price_per_kg_thb=Decimal(60),
                    stock_kg=1,
                    active=True,
                ),
                models.Listing(
                    id="a",
                    fruit_id="mango",
                    seller_id="two",
                    price_per_kg_thb=Decimal(60),
                    stock_kg=0,
                    active=True,
                ),
                models.Listing(
                    id="c",
                    fruit_id="pineapple",
                    seller_id="one",
                    price_per_kg_thb=Decimal(30),
                    stock_kg=2,
                    active=False,
                ),
            ]
        )
        session.add_all(
            models.Usage(
                shop_id=shop_id,
                fruit_id="mango",
                usage_date=today - timedelta(days=age),
                quantity_kg=Decimal(quantity),
            )
            for shop_id, age, quantity in [
                ("smoothies", 1, 5),
                ("smoothies", 7, 2),
                ("smoothies", 8, 3),
                ("smoothies", 0, 4),
                ("bakery", 1, 9),
            ]
        )

    catalog = CatalogRepository(marketplace_engine)
    assert catalog.usage_totals("smoothies", today) == (
        UsageTotal("mango", Decimal(7)),
    )
    assert catalog.usage_totals("bakery", today) == (UsageTotal("mango", Decimal(9)),)
    app = FastAPI()
    app.include_router(catalog_router(catalog))
    with TestClient(app) as client:
        assert "smoothies" in {
            shop["id"] for shop in client.get("/shops").json()["shops"]
        }
        assert client.get("/shops/smoothies").json() == {
            "id": "smoothies",
            "name": "Smoothie Café",
            "category": "cafe",
            "menu_tags": ["smoothie"],
        }
        assert client.get("/shops/unknown").status_code == 404
        assert (
            client.get("/listings", params={"fruit_id": "unknown"}).status_code == 404
        )
        assert client.get("/listings", params={"fruit_id": "pineapple"}).json() == {
            "listings": []
        }
        offers = client.get("/listings", params={"fruit_id": "mango"}).json()[
            "listings"
        ]
        assert [(offer["id"], offer["stock_kg"]) for offer in offers] == [
            ("a", 0),
            ("b", 1),
        ]
        assert offers[0] == {
            "id": "a",
            "seller": {"id": "two", "name": "Two", "area": "Bangkok", "rating": 4.8},
            "fruit": {
                "id": "mango",
                "name_en": "Mango",
                "name_th": "มะม่วง",
                "tags": ["tropical"],
            },
            "price_per_kg_thb": "60.00",
            "stock_kg": 0,
            "active": True,
        }
        assert client.get("/listings").json() == {"listings": offers}
