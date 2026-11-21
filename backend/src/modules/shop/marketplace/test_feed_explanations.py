from concurrent.futures import ThreadPoolExecutor
from threading import Event

from .feed_explanations import FeedExplanations, template
from .ranking import rank
from .test_ranking import MANGO, SHOP, offer

ITEMS = rank(SHOP, (), (offer("market", MANGO, "80", 10),), ())


class Store:
    def __init__(self) -> None:
        self.batches: dict[tuple[str, str], dict[str, str]] = {}

    def get(self, feed_key: str, locale: str) -> dict[str, str]:
        return self.batches.get((feed_key, locale), {})

    def save(self, feed_key: str, locale: str, explanations: dict[str, str]) -> None:
        self.batches[feed_key, locale] = explanations


def test_templates_and_invalid_output() -> None:
    assert template(ITEMS[0]) == (
        "Mango fits your smoothie menu. Suggested 0 kg from Farm at ฿80.00/kg."
    )
    service = FeedExplanations(lambda items, locale: {"mango": "Buy 500 kg."}, Store())
    assert service.generate("key", "en", ITEMS) == {}
    assert service.cached("key", "en") == {}


def test_concurrent_requests_share_the_batch_and_cache_by_locale() -> None:
    entered, release = Event(), Event()
    calls: list[str] = []

    def explain(items, locale):
        calls.append(locale)
        entered.set()
        assert release.wait(3)
        return {"mango": "Mango suits your menu."}

    service = FeedExplanations(explain, Store())
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.generate, "key", "en", ITEMS)
        assert entered.wait(3)
        second = pool.submit(service.generate, "key", "en", ITEMS)
        release.set()
        assert first.result() == second.result() == {"mango": "Mango suits your menu."}
    assert calls == ["en"]
    assert service.cached("key", "en") == {"mango": "Mango suits your menu."}
    assert service.cached("key", "th") == {}


def test_provider_sends_one_structured_request_with_locale_and_facts() -> None:
    import json

    import httpx
    from openai import OpenAI

    from .feed_explanations import OpenAIFeedExplanations

    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "resp_test",
                "object": "response",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_test",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": '{"items":[{"fruit_id":"mango","explanation":"มะม่วงเหมาะกับเมนูของคุณ"}]}',
                                "annotations": [],
                            }
                        ],
                    }
                ],
            },
        )

    with OpenAI(
        api_key="test",
        http_client=httpx.Client(transport=httpx.MockTransport(respond)),
    ) as client:
        service = FeedExplanations(
            OpenAIFeedExplanations(client, "gpt-6-luna", {"effort": "none"}),
            Store(),
        )
        assert service.generate("key", "th", ITEMS) == {"mango": "มะม่วงเหมาะกับเมนูของคุณ"}
    (body,) = requests
    assert body["text"]["format"]["type"] == "json_schema"
    assert json.loads(body["input"])["locale"] == "th"
    assert json.loads(body["input"])["items"][0]["price_per_kg_thb"] == "80.00"


def test_successful_batch_is_shared_across_service_instances(
    marketplace_engine,
) -> None:
    from sqlalchemy.orm import Session

    from . import models
    from .explanation_store import SqlExplanationStore

    with Session(marketplace_engine) as session, session.begin():
        session.add(models.Fruit(id="mango", name_en="Mango", name_th="มะม่วง", tags=[]))

    expected = {"mango": "Mango suits your menu."}
    service = FeedExplanations(
        lambda items, locale: expected, SqlExplanationStore(marketplace_engine)
    )
    assert service.generate("feed", "en", ITEMS) == expected

    def unexpected_provider(items, locale):
        raise AssertionError("Persisted results should avoid a provider call.")

    other = FeedExplanations(
        unexpected_provider, SqlExplanationStore(marketplace_engine)
    )
    assert other.generate("feed", "en", ITEMS) == expected
    assert other.cached("feed", "th") == {}
