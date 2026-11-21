import json
from decimal import Decimal

import httpx
import pytest
from openai import OpenAI

from .explanations import OpenAIExplanations, template
from .planner import Recommendation

FLAGGED = Recommendation("mango", Decimal(8), Decimal(2), 6, True, False)
UNFLAGGED = Recommendation("banana", Decimal(3), Decimal(4), 0, False, False)


@pytest.mark.parametrize(
    "output",
    [
        [{"fruit_id": "mango", "text": "Mango demand exceeds usable stock."}],
        [],
        [{"fruit_id": "banana", "text": "Unexpected fruit."}],
        [{"fruit_id": "mango", "text": " "}],
        [{"fruit_id": "mango", "text": "**Markdown**"}],
        [{"fruit_id": "mango", "text": "One."}, {"fruit_id": "mango", "text": "Two."}],
        [{"fruit_id": "mango", "text": 7}],
        None,
    ],
)
def test_structured_output_and_fallback(output):
    requests = []

    def transport(request):
        requests.append(json.loads(request.content))
        if output is None:
            return httpx.Response(503, json={"error": {"message": "Unavailable"}})
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
                                "text": json.dumps({"items": output}),
                                "annotations": [],
                            }
                        ],
                    }
                ],
            },
        )

    with OpenAI(
        api_key="test",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(transport)),
    ) as client:
        result = OpenAIExplanations(client)((FLAGGED, UNFLAGGED))
    expected = (
        "Mango demand exceeds usable stock."
        if output and output[0]["text"] == ("Mango demand exceeds usable stock.")
        else template(FLAGGED)
    )
    assert result == {"mango": expected}
    (request,) = requests
    assert request["model"] == "gpt-6-luna"
    assert request["text"]["format"]["type"] == "json_schema"
    assert request["store"] is False
    assert json.loads(request["input"]) == [
        {
            "fruit_id": "mango",
            "forecast_kg": "8",
            "usable_stock_kg": "2",
            "suggested_kg": 6,
            "shortage": True,
            "surplus": False,
        }
    ]


def test_timeout_and_missing_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    expected = {"mango": template(FLAGGED)}
    assert OpenAIExplanations.from_env()((FLAGGED,)) == expected

    def timeout(request):
        raise httpx.ReadTimeout("Timed out", request=request)

    with OpenAI(
        api_key="test",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(timeout)),
    ) as client:
        assert OpenAIExplanations(client)((FLAGGED,)) == expected
        assert OpenAIExplanations(client)((UNFLAGGED,)) == {}
