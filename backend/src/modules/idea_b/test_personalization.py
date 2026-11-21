from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.idea_b.personalization import (
    FarmOption,
    RecommendationRequest,
    bangkok_today,
    recommend,
)

ENDPOINT = "/api/ideas/idea-b/recommendations"


def order_payload(**overrides: object) -> dict[str, object]:
    return {
        "buyer_id": "demo-cafe-1",
        "fruit": "mango",
        "quantity_kg": 100,
        "delivery_by": (bangkok_today() + timedelta(days=7)).isoformat(),
        **overrides,
    }


def options(**overrides: object) -> list[FarmOption]:
    today = bangkok_today()
    return recommend(RecommendationRequest.model_validate(order_payload(**overrides)), today).options


def test_cost_provenance_and_familiarity() -> None:
    best, familiar, unknown_shipping = options(quantity_kg="100.05")
    assert best.subtotal_thb == 4002
    assert best.total_cost_thb == 4362
    assert best.estimated_fees_thb == 20
    assert familiar.familiar
    assert familiar.total_cost_thb == 5472.60
    assert unknown_shipping.total_cost_thb is None
    assert unknown_shipping.missing_fields == ["estimated_shipping_thb"]
    assert all("synthetic" in farm.provenance for farm in (best, familiar, unknown_shipping))


def test_preferences_change_order_and_ties_are_stable() -> None:
    weights = {"price_weight": 0, "quality_weight": 0, "reliability_weight": 0, "relationship_weight": 1}
    ranked = options(preferences=weights)
    assert [(farm.farm_id, farm.score) for farm in ranked] == [
        ("chanthaburi-orchard", 100), ("orchard-korat", 0), ("sunrise-mango", 0),
    ]
    assert not any(farm.familiar for farm in options(buyer_id="another-buyer"))


def test_filters_apply_before_ranking() -> None:
    assert [farm.farm_id for farm in options(quantity_kg=20)] == ["orchard-korat"]
    assert [farm.farm_id for farm in options(quantity_kg=600)] == ["sunrise-mango"]
    assert not options(quantity_kg="600.01")
    assert [farm.farm_id for farm in options(delivery_by=bangkok_today() + timedelta(days=1))] == [
        "chanthaburi-orchard",
    ]
    assert [farm.farm_id for farm in options(max_total_thb=4360)] == ["sunrise-mango"]
    assert not options(max_total_thb="4359.99")
    assert len(options(fruit="pineapple")) == 2


@pytest.mark.parametrize("invalid", [
    {"quantity_kg": 0}, {"quantity_kg": "1.234"}, {"delivery_by": "not-a-date"},
    {"delivery_by": "2000-01-01"}, {"delivery_by": 4_102_444_800}, {"fruit": "banana"}, {"max_total_thb": -1},
    {"preferences": {"price_weight": 0, "quality_weight": 0, "reliability_weight": 0, "relationship_weight": 0}},
])
def test_invalid_api_input(invalid: dict[str, object]) -> None:
    assert TestClient(app).post(ENDPOINT, json=order_payload(**invalid)).status_code == 422


def test_api_returns_ranked_and_empty_envelopes() -> None:
    client = TestClient(app)
    response = client.post(ENDPOINT, json=order_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["data_status"] == "demo"
    assert body["explanation_source"] == "deterministic"
    assert body["options"][0]["farm_id"] == "sunrise-mango"
    empty = client.post(ENDPOINT, json=order_payload(quantity_kg=1000)).json()
    assert empty["options"] == []
    assert empty["explanation"]


def test_thai_recommendations_keep_the_same_ranking_and_amounts() -> None:
    client = TestClient(app)
    order = order_payload()
    english = client.post(ENDPOINT, json=order).json()
    thai = client.post(f"{ENDPOINT}?lang=th", json=order).json()
    assert thai["options"][0]["farm_name"] == "สวนมะม่วงซันไรส์"
    assert "จัดอันดับฟาร์ม" in thai["explanation"]
    for local, original in zip(thai["options"], english["options"], strict=True):
        for field in ("farm_id", "total_cost_thb", "availability", "score", "missing_fields"):
            assert local[field] == original[field]
    assert client.post(f"{ENDPOINT}?lang=fr", json=order).status_code == 422
