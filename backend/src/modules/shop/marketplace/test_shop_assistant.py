import json
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openai.types.responses import ResponseInputParam
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.db.alembic.versions import idea_a_0005

from ..scheduler import BANGKOK
from . import models
from .shop_assistant import AssistantUnavailable, ShopTools, shop_assistant_router


def test_assistant_reads_real_stock_and_only_proposes_cart_actions(
    marketplace_engine: Engine,
) -> None:
    with (
        marketplace_engine.begin() as connection,
        Operations.context(MigrationContext.configure(connection)),
    ):
        idea_a_0005.upgrade()
    day = datetime.now(BANGKOK).date()
    with Session(marketplace_engine) as session, session.begin():
        session.add_all(
            [
                models.Shop(
                    id="bakery", name="Bakery", category="bakery", menu_tags=[]
                ),
                models.Shop(id="other", name="Other", category="cafe", menu_tags=[]),
                models.Ingredient(
                    id="milk",
                    name_en="Milk",
                    name_th="นมสด",
                    tags=[],
                    aliases=[],
                    category="dairy",
                    unit="kg",
                ),
                models.Seller(
                    id="dairy", name="Dairy", area="Bangkok", rating=Decimal(5)
                ),
            ]
        )
        session.flush()
        session.add(
            models.Usage(
                shop_id="bakery",
                ingredient_id="milk",
                usage_date=day - timedelta(days=1),
                quantity_kg=Decimal(7),
            )
        )
        session.add(
            models.Listing(
                id="milk-dairy",
                seller_id="dairy",
                ingredient_id="milk",
                active=True,
                stock_kg=8,
                price_per_kg_thb=Decimal("43.00"),
            )
        )

    calls: list[ResponseInputParam] = []

    def reply(history: ResponseInputParam, tools: ShopTools, locale: str) -> str:
        assert tools.shop_id == "bakery" and locale == "en"
        calls.append(history)
        assert json.loads(tools("get_shop_stock", '{"shop_id":"other"}'))["error"]
        stock = json.loads(tools("get_shop_stock", '{"ingredient":"milk"}'))[0]
        assert stock["kg_on_hand"] == "3.000" and stock["days_of_cover"] == "3.00"
        action = json.loads(
            tools("propose_add_to_cart", '{"listing_id":"milk-dairy","qty_kg":2}')
        )
        assert action["executed"] is False
        return "You have three days of milk left."

    app = FastAPI()
    app.include_router(shop_assistant_router(marketplace_engine, reply=reply))
    client = TestClient(app)
    assert client.put(
        "/shops/bakery/stock", json={"ingredient_id": "milk", "kg_on_hand": "3"}
    ).is_success
    assert (
        client.put(
            "/shops/bakery/stock", json={"ingredient_id": "milk", "kg_on_hand": "-1"}
        ).status_code
        == 422
    )
    stock_row = client.get("/shops/bakery/stock").json()["items"][0]
    assert Decimal(stock_row["usage_7d_kg"]) == 7 and stock_row["reorder_kg"] == 4
    unknown_count = client.get("/shops/other/stock").json()["items"][0]
    assert unknown_count["kg_on_hand"] is None and unknown_count["reorder_kg"] is None
    base = "/shops/bakery/agent/threads"
    first = client.post(base).json()["id"]
    messages = f"{base}/{first}/messages"
    payload = {
        "request_id": str(uuid4()),
        "message": "Do I have enough milk?",
        "locale": "en",
        "page_context": {"page": "today"},
    }
    assert client.get(messages).json() == {"messages": []}
    assert not calls
    response = client.post(messages, json=payload)
    assert response.is_success and response.headers["content-type"].startswith(
        "text/event-stream"
    )
    assert "three days of milk" in response.text and "event: actions" in response.text
    assert client.post(messages, json=payload).text == response.text
    assert len(calls) == 1
    assert client.get(messages.replace("bakery", "other")).status_code == 404
    assert client.get(base).json()["threads"][0]["title"] == payload["message"]
    for _ in range(3):
        assert client.post(base).status_code == 201
    assert len(client.get(base).json()["threads"]) == 3
    with Session(marketplace_engine) as session:
        assert (
            session.scalar(
                select(models.Listing.stock_kg).where(models.Listing.id == "milk-dairy")
            )
            == 8
        )


def test_assistant_provider_failure_remains_retryable(
    marketplace_engine: Engine,
) -> None:
    with (
        marketplace_engine.begin() as connection,
        Operations.context(MigrationContext.configure(connection)),
    ):
        idea_a_0005.upgrade()
    with Session(marketplace_engine) as session, session.begin():
        session.add(
            models.Shop(id="bakery", name="Bakery", category="bakery", menu_tags=[])
        )

    calls = 0

    def reply(_history: ResponseInputParam, _tools: ShopTools, _locale: str) -> str:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise AssistantUnavailable
        return "Recovered."

    app = FastAPI()
    app.include_router(shop_assistant_router(marketplace_engine, reply=reply))
    client = TestClient(app)
    thread = client.post("/shops/bakery/agent/threads").json()["id"]
    url = f"/shops/bakery/agent/threads/{thread}/messages"
    payload = {
        "request_id": str(uuid4()),
        "message": "Ideas?",
        "page_context": {"page": "today"},
    }
    assert "event: error" in client.post(url, json=payload).text
    assert client.get(url).json()["messages"] == []
    assert "Recovered." in client.post(url, json=payload).text
    assert len(client.get(url).json()["messages"]) == 1


def test_live_provider_streams_chunks_and_bounds_tool_rounds(
    monkeypatch, marketplace_engine: Engine
) -> None:
    from types import SimpleNamespace

    from . import shop_assistant

    class Call:
        type = "function_call"
        name = "unknown"
        arguments = "{}"
        call_id = "tool-1"

        def model_dump(self, **_kwargs):
            return {
                "type": self.type,
                "name": self.name,
                "arguments": self.arguments,
                "call_id": self.call_id,
                "parsed_arguments": {"ingredient": "flour"},
            }

    requests: list[dict[str, object]] = []

    class FakeStream:
        def __init__(self, answer: bool) -> None:
            self.answer = answer

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def __iter__(self):
            if self.answer:
                for delta in ("Fresh ", "answer."):
                    yield SimpleNamespace(
                        type="response.output_text.delta", delta=delta
                    )
            else:
                yield SimpleNamespace(
                    type="response.output_text.delta", delta="Working"
                )
                yield SimpleNamespace(type="response.output_item.added", item=Call())

        def get_final_response(self):
            return SimpleNamespace(
                output=[] if self.answer else [Call()],
                status="completed",
                output_text="Fresh answer." if self.answer else "",
            )

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = self

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def stream(self, **kwargs):
            requests.append({**kwargs, "input": list(kwargs["input"])})
            return FakeStream(answer=len(requests) == 5)

    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setattr(shop_assistant, "OpenAI", FakeClient)
    tools = ShopTools(marketplace_engine, "bakery", "en", datetime.now(BANGKOK))
    events = list(shop_assistant.openai_reply([], tools, "en"))
    assert [event for event in events if not isinstance(event, shop_assistant.ToolActivity)] == [
        "Working",
        None,
        "Working",
        None,
        "Working",
        None,
        "Working",
        None,
        "Fresh ",
        "answer.",
    ]
    assert [
        event.state for event in events if isinstance(event, shop_assistant.ToolActivity)
    ] == ["running", "error"] * 4
    assert len(requests) == 5 and requests[-1]["tools"] == []
    follow_up = requests[1]["input"]
    assert isinstance(follow_up, list)
    assert follow_up[0] == {
        "type": "function_call", "call_id": "tool-1", "name": "unknown", "arguments": "{}",
    }
