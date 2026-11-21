from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.copilot.trends import score_changes, week_over_week

ENDPOINT = "/api/ideas/idea-b/trends"


@pytest.mark.parametrize(("changes", "expected"), [
    ([1000, -50], (25, "rising")), ([-1000, 50], (-25, "falling")),
    ([20, 10], (15, "rising")), ([-20, -10], (-15, "falling")),
    ([10, 10], (10, "steady")), ([15], (None, "insufficient_data")),
])
def test_score(changes: list[int], expected: tuple[int | None, str]) -> None:
    assert score_changes([Decimal(change) for change in changes]) == expected


def test_growth_requires_a_nonzero_baseline_and_current_value() -> None:
    assert week_over_week(0, 50) is None
    assert week_over_week(None, 50) is None
    assert week_over_week(50, None) is None
    assert week_over_week(50, 0) == -100


def test_trend_contract_and_provenance() -> None:
    client = TestClient(app)
    response = client.get(ENDPOINT, params={"fruit": "mango"})
    assert response.status_code == 200
    data = response.json()
    assert data["fruit"] == "mango"
    assert data["observed_period"] == {"start": "2026-11-09", "end": "2026-11-15"}
    assert data["score"] == 30.65
    assert data["trend_label"] == "rising"
    assert data["data_status"] == "demo"
    assert data["explanation_source"] == "deterministic"
    assert data["limitations"]
    assert [signal["week_over_week_pct"] for signal in data["signals"]] == [29.17, 32.14]
    sources = {source["source_id"]: source for source in data["sources"]}
    for signal in data["signals"]:
        source = sources[signal["source_id"]]
        assert "synthetic" in source["name"]
        assert source["geographic_scope"] == "Thailand"
        assert source["metric_definition"]
        assert source["collected_at"].startswith("2026-11-16")

    sparse = client.get(ENDPOINT, params={"fruit": "pineapple"}).json()
    assert sparse["score"] is None
    assert sparse["trend_label"] == "insufficient_data"
    assert sparse["signals"][0]["week_over_week_pct"] == -5.08
    assert sparse["signals"][1]["week_over_week_pct"] is None
    assert client.get(ENDPOINT, params={"fruit": "banana"}).status_code == 422


def test_thai_trends_localize_explanations_and_provenance() -> None:
    client = TestClient(app)
    thai = client.get(f"{ENDPOINT}?fruit=mango&lang=th").json()
    english = client.get(f"{ENDPOINT}?fruit=mango&lang=en").json()
    assert thai["score"] == english["score"]
    assert thai["signals"] == english["signals"]
    assert "ความสนใจจากข้อมูลจำลองเพิ่มขึ้น" in thai["explanation"]
    assert thai["sources"][0]["geographic_scope"] == "ประเทศไทย"
