from datetime import datetime, timedelta
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg import connect
from psycopg.conninfo import make_conninfo
from sqlalchemy import Engine

from backend.db.alembic.versions import idea_a_0006, idea_a_0007
from backend.db.seeds.shop.catalog import seed_daily_marketplace
from backend.db.seeds.shop.trials import seed_trial_terms
from backend.src.modules.shop.scheduler import BANGKOK
from backend.src.shared.db import database_url

from .trials import trial_router


def test_trial_limits_quote_replay_and_supplier_stock(daily_marketplace_engine: Engine):
    engine = daily_marketplace_engine
    now = datetime.now(BANGKOK)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        idea_a_0006.upgrade()
        idea_a_0007.upgrade()
        schema = conn.exec_driver_sql("select current_schema()").scalar_one()
    with connect(
        make_conninfo(database_url(), options=f"-csearch_path={schema}")
    ) as db:
        seed_daily_marketplace(db, now.date())
        seed_trial_terms(db)
    app = FastAPI()
    app.include_router(trial_router(engine, lambda: now))
    client = TestClient(app)
    path = "/shops/bakery-main/trial-lots"
    params = {
        "trend": "pistachio-gelato",
        "ingredient": "milk",
        "qty": 2,
        "budget": 500,
        "needed_by": (now.date() + timedelta(days=3)).isoformat(),
    }
    lot = client.get(path, params=params).json()[0]
    assert lot["reasons"] == [] and float(lot["total"]) == 134
    assert (
        "budget"
        in client.get(path, params={**params, "budget": 100}).json()[0]["reasons"]
    )
    assert (
        "late"
        in client.get(
            path, params={**params, "needed_by": now.date().isoformat()}
        ).json()[0]["reasons"]
    )
    req = {
        **params,
        "id": str(uuid4()),
        "listing_id": lot["listing_id"],
        "expected_total": lot["total"],
        "match_ms": 3194,
    }
    quote = "/shops/bakery-main/trial-quotes"
    assert client.post("/shops/bakery-main/trial-matches", json=req).status_code == 200
    assert client.post(quote, json=req).status_code == 200
    assert client.post(quote, json=req).json() == {"id": req["id"]}
    assert len(client.get("/sellers/thaidairy/trials").json()["quotes"]) == 1
    assert client.get("/shops/bakery-main/trial-activity").json() == {
        "matches": 1,
        "quotes": 1,
        "median_ms": 3194,
    }
    update = {
        "stock_kg": 0,
        "price_per_kg_thb": 42,
        "min_kg": 1,
        "lead_days": 1,
        "shipping_thb": 50,
    }
    assert (
        client.put(
            "/sellers/dairypro/trial-lots/milk-thaidairy", json=update
        ).status_code
        == 404
    )
    assert (
        client.put(
            "/sellers/thaidairy/trial-lots/milk-thaidairy", json=update
        ).status_code
        == 200
    )
    assert "stock" in client.get(path, params=params).json()[0]["reasons"]
    assert client.post(quote, json={**req, "id": str(uuid4())}).status_code == 409
