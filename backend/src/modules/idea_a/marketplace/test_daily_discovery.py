import json
from datetime import date

import httpx
import pytest
from openai import OpenAI

from .daily_discovery import (
    DailyDiscoveryFailure,
    IngredientCatalogItem,
    OpenAIDailyDiscovery,
)
from .test_trend_provider import OTHER_SOURCE, SOURCE, UNSUPPORTED, completed_response

DAY = date(2026, 11, 21)
CATALOG = (IngredientCatalogItem("paste", "Pistachio paste", "พิสตาชิโอบด"),)


def trend_candidate(slug="pistachio-gelato", *sources, confidence=0.8):
    return {
        "slug": slug,
        "name_en": "Pistachio Gelato",
        "name_th": "เจลาโตพิสตาชิโอ",
        "kind": "dessert",
        "momentum": "rising",
        "why_rising_en": "Thai outlets reported new menu launches this week.",
        "why_rising_th": "มีเมนูใหม่ในสัปดาห์นี้",
        "confidence": confidence,
        "momentum_evidence": "New local menu launches",
        "sources": [
            {"url": url, "published_at": published_at} for url, published_at in sources
        ],
    }


def _response(candidates):
    return httpx.Response(
        200,
        json=completed_response(json.dumps({"trends": candidates}, ensure_ascii=False)),
    )


def test_request_and_normalization_ground_sparse_evidence():
    requests = []

    def transport(request):
        requests.append(json.loads(request.content))
        return _response(
            [
                trend_candidate(
                    "fabricated", (UNSUPPORTED, None), ("javascript:bad", None)
                ),
                trend_candidate("old", (SOURCE, "2026-11-14")),
                trend_candidate("future", (SOURCE, "2026-11-22")),
                trend_candidate("invalid", (SOURCE, None), confidence=1.2),
                trend_candidate(
                    "pistachio-gelato",
                    (SOURCE, "2026-11-19"),
                    (f"{SOURCE}#duplicate", None),
                    (OTHER_SOURCE, "2026-10-01"),
                    (UNSUPPORTED, None),
                ),
                trend_candidate("second", (SOURCE, None)),
            ]
        )

    with OpenAI(
        api_key="test",
        http_client=httpx.Client(transport=httpx.MockTransport(transport)),
    ) as client:
        (trend,) = OpenAIDailyDiscovery(client, cap=1)(DAY, CATALOG)

    assert trend.slug == "pistachio-gelato"
    assert trend.momentum == "rising"
    assert trend.momentum_evidence == "New local menu launches"
    (source,) = trend.sources
    assert (source.url, source.title, source.published_at) == (
        SOURCE,
        "Thai recipes",
        date(2026, 11, 19),
    )
    (body,) = requests
    assert body["include"] == ["web_search_call.action.sources"]
    assert body["tools"][0]["user_location"]["country"] == "TH"
    assert "filters" not in body["tools"][0]
    facts = json.loads(body["input"])
    assert facts["current_bangkok_date"] == "2026-11-21"
    assert facts["from_date"] == "2026-11-15"
    assert facts["lookback_days"] == 7 and facts["trend_cap"] == 1
    assert facts["catalog"][0]["id"] == "paste"


@pytest.mark.parametrize(
    ("filter_error", "expected_calls"), [("unsupported", 2), ("invalid", 1)]
)
def test_only_unsupported_filters_fall_back_to_prompt(filter_error, expected_calls):
    requests = []

    def transport(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(
                400,
                json={
                    "error": {
                        "message": f"{filter_error} parameter",
                        "param": "tools[0].filters",
                    }
                },
            )
        return _response([trend_candidate("pistachio-gelato", (SOURCE, None))])

    with OpenAI(
        api_key="test",
        http_client=httpx.Client(transport=httpx.MockTransport(transport)),
    ) as client:
        provider = OpenAIDailyDiscovery(client, allowed_domains=("wongnai.com",))
        if expected_calls == 2:
            assert provider(DAY, CATALOG)
        else:
            with pytest.raises(DailyDiscoveryFailure, match="unavailable"):
                provider(DAY, CATALOG)
    assert len(requests) == expected_calls
    assert requests[0]["tools"][0]["filters"] == {"allowed_domains": ["wongnai.com"]}
    if expected_calls == 2:
        assert "filters" not in requests[1]["tools"][0]
        assert "wongnai.com" in requests[1]["instructions"]


@pytest.mark.parametrize(
    ("scenario", "reason"),
    [
        ("timeout", "timeout"),
        ("empty", "invalid_output"),
        ("unavailable", "unavailable"),
    ],
)
def test_daily_discovery_failure_reasons(scenario, reason):
    def transport(request):
        if scenario == "timeout":
            raise httpx.ReadTimeout("Timed out", request=request)
        if scenario == "unavailable":
            return httpx.Response(503, json={"error": {"message": "unavailable"}})
        return _response([])

    with (
        OpenAI(
            api_key="test",
            http_client=httpx.Client(transport=httpx.MockTransport(transport)),
        ) as client,
        pytest.raises(DailyDiscoveryFailure, match=reason),
    ):
        OpenAIDailyDiscovery(client)(DAY, CATALOG)
