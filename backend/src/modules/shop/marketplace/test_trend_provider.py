import json
from datetime import date

import httpx
import pytest
from openai import OpenAI

from .trend_provider import (
    OpenAITrendProvider,
    TrendFruit,
    TrendProviderFailure,
    TrendRequest,
)

REQUEST = TrendRequest(
    date(2026, 11, 21),
    (TrendFruit("mango", "Mango", "มะม่วง"), TrendFruit("banana", "Banana", "กล้วย")),
)
SOURCE = "https://www.wongnai.com/recipes/mango"
OTHER_SOURCE = "https://sanook.com/food/mango/"
UNSUPPORTED = "https://example.com/made-up"


def candidate(fruit_id: str, *urls: str) -> dict[str, object]:
    return {
        "fruit_id": fruit_id,
        "trend_name": "Mango drinks",
        "rationale": "Mango appears in seasonal drink coverage. Smoothies are a common example.",
        "related_menus": ["Mango smoothie"],
        "confidence": 0.8,
        "urls": urls,
    }


def completed_response(payload: str) -> dict[str, object]:
    return {
        "id": "resp_test",
        "object": "response",
        "status": "completed",
        "output": [
            {
                "id": "ws_test",
                "type": "web_search_call",
                "status": "completed",
                "action": {
                    "type": "search",
                    "query": "Thai mango drinks",
                    "sources": [
                        {"type": "url", "url": SOURCE},
                        {"type": "url", "url": OTHER_SOURCE},
                    ],
                },
            },
            {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "type": "output_text",
                        "text": payload,
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url": SOURCE,
                                "title": "Thai recipes",
                                "start_index": 1,
                                "end_index": 3,
                            },
                            {
                                "type": "url_citation",
                                "url": UNSUPPORTED,
                                "title": "Made-up",
                                "start_index": 1,
                                "end_index": 3,
                            },
                        ],
                    }
                ],
            },
        ],
    }


@pytest.mark.parametrize("allow_domains", [(), ("wongnai.com", "sanook.com")])
def test_request_uses_web_sources_and_scores_only_supported_distinct_mentions(
    allow_domains,
):
    requests = []
    payload = json.dumps(
        {
            "cards": [
                candidate("unknown", SOURCE),
                candidate("banana", UNSUPPORTED),
                candidate("mango", SOURCE, f"{SOURCE}#dish", OTHER_SOURCE, UNSUPPORTED),
                candidate("mango", SOURCE),
            ]
        }
    )

    def transport(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=completed_response(payload))

    with OpenAI(
        api_key="test",
        http_client=httpx.Client(transport=httpx.MockTransport(transport)),
    ) as client:
        (card,) = OpenAITrendProvider(client, allowed_domains=allow_domains)(REQUEST)

    assert card.fruit_id == "mango"
    assert card.mention_count == 2
    assert card.score == pytest.approx(0.64)
    assert [(source.url, source.title) for source in card.sources] == [
        (SOURCE, "Thai recipes"),
        (OTHER_SOURCE, "sanook.com"),
    ]

    (body,) = requests
    assert body["include"] == ["web_search_call.action.sources"]
    assert body["model"] == "gpt-6-luna"
    assert body["reasoning"] == {"effort": "low"}
    assert body["max_tool_calls"] == 3
    assert body["store"] is False
    assert body["text"]["format"]["strict"] is True
    (tool,) = body["tools"]
    assert tool["type"] == "web_search"
    if allow_domains:
        assert tool["filters"] == {"allowed_domains": list(allow_domains)}
    else:
        assert "filters" not in tool
        assert "Wongnai" in body["instructions"]
    facts = json.loads(body["input"])
    assert (facts["current_bangkok_date"], facts["region"], facts["lookback_days"]) == (
        "2026-11-21",
        "TH",
        7,
    )
    assert facts["from_date"] == "2026-11-15"
    assert [fruit["id"] for fruit in facts["catalog"]] == ["mango", "banana"]


def test_card_cap_and_field_validation():
    fruit_ids = tuple(str(index) for index in range(7))
    request = TrendRequest(
        REQUEST.day, tuple(TrendFruit(id_, id_, id_) for id_ in fruit_ids)
    )
    invalid_confidence = candidate("0", SOURCE) | {"confidence": 1.1}
    invalid_rationale = candidate("1", SOURCE) | {"rationale": "One. Two. Three."}
    payload = json.dumps(
        {
            "cards": [
                invalid_confidence,
                invalid_rationale,
                *(candidate(id_, SOURCE) for id_ in reversed(fruit_ids)),
            ],
        }
    )

    with OpenAI(
        api_key="test",
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=completed_response(payload))
            )
        ),
    ) as client:
        cards = OpenAITrendProvider(client)(request)

    assert [card.fruit_id for card in cards] == list(reversed(fruit_ids))[:5]


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("bad_json", "invalid_output"),
        ("no_supported_sources", "invalid_output"),
        ("timeout", "timeout"),
        ("provider_error", "unavailable"),
    ],
)
def test_typed_failures(case, reason):
    calls = 0

    def transport(request):
        nonlocal calls
        calls += 1
        if case == "timeout":
            raise httpx.ReadTimeout("Timed out.", request=request)
        if case == "provider_error":
            return httpx.Response(503, json={"error": {"message": "Unavailable"}})
        payload = (
            "{invalid"
            if case == "bad_json"
            else json.dumps(
                {
                    "cards": [candidate("banana", UNSUPPORTED)],
                }
            )
        )
        return httpx.Response(200, json=completed_response(payload))

    with OpenAI(
        api_key="test",
        http_client=httpx.Client(transport=httpx.MockTransport(transport)),
    ) as client, pytest.raises(TrendProviderFailure) as exc:
        OpenAITrendProvider(client)(REQUEST)
    assert exc.value.reason == reason
    assert calls == 1
