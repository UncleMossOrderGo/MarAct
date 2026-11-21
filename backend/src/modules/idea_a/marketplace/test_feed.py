from dataclasses import replace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from .feed import FeedService, feed_router
from .feed_explanations import FeedExplanations
from .test_feed_explanations import Store
from .test_ranking import MANGO, SHOP, offer


class Catalog:
    def __init__(self) -> None:
        self.offer = offer("market", MANGO, "80", 10)

    def shop(self, shop_id):
        return SHOP if shop_id == SHOP.id else None

    def listings(self, fruit_id=None):
        return (self.offer,)

    def usage_totals(self, shop_id, planning_date):
        return ()


def test_feed_is_immediate_and_stream_uses_cache() -> None:
    calls: list[str] = []

    def explain(items, locale):
        calls.append(locale)
        return {"mango": "Mango looks good on the menu."}

    catalog = Catalog()
    app = FastAPI()
    app.include_router(
        feed_router(
            FeedService(
                catalog,
                lambda: ("run", ()),
                FeedExplanations(explain, Store()),
            )
        )
    )
    client = TestClient(app)
    url = f"/shops/{SHOP.id}/feed"
    initial = client.get(url).json()
    assert initial["run_id"] == "run"
    assert initial["items"][0]["explanation_source"] == "template"
    assert initial["items"][0]["listings"][0]["price_per_kg_thb"] == "80.00"
    assert not calls

    params = {"feed_key": initial["feed_key"], "locale": "en"}
    stream = client.get(f"{url}/explanations", params=params)
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert 'event: explanation\ndata: {"fruit_id": "mango"' in stream.text
    assert stream.text.endswith("event: done\ndata: {}\n\n")
    assert client.get(url).json()["items"][0]["explanation_source"] == "ai"
    assert client.get(f"{url}/explanations", params=params).text == stream.text
    assert calls == ["en"]

    catalog.offer = replace(catalog.offer, stock_kg=7)
    assert client.get(f"{url}/explanations", params=params).status_code == 409
    assert client.get("/shops/unknown/feed").status_code == 404


def test_feed_stays_usable_without_generated_text() -> None:
    app = FastAPI()
    app.include_router(
        feed_router(
            FeedService(
                Catalog(),
                lambda: (None, ()),
                FeedExplanations(lambda items, locale: {}, Store()),
            )
        )
    )
    client = TestClient(app)
    url = f"/shops/{SHOP.id}/feed"
    response = client.get(url).json()
    stream = client.get(
        f"{url}/explanations", params={"feed_key": response["feed_key"]}
    )
    assert stream.text == "event: done\ndata: {}\n\n"
    assert client.get(url).json() == response
