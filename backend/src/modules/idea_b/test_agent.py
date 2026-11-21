import io
import json
from datetime import timedelta
from urllib.request import Request

import pytest
from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.idea_b import agent
from backend.src.modules.idea_b.personalization import bangkok_today

BASE = "/api/ideas/idea-b"


def test_interpretation_validates_structured_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    deadline = (bangkok_today() + timedelta(days=7)).isoformat()
    output = {
        "fruit": "mango", "quantity_kg": 100.5, "delivery_by": deadline, "max_total_thb": 5500,
        "preferences": {
            "price_weight": 100, "quality_weight": None, "reliability_weight": None, "relationship_weight": None,
        },
        "unsupported_constraints": ["Organic certification"],
    }

    def fake_open(request: Request, timeout: float) -> io.BytesIO:
        assert request.full_url == "https://api.openai.com/v1/responses"
        assert timeout == 6
        payload = request.data
        assert isinstance(payload, bytes)
        body = json.loads(payload)
        assert body["model"] == "test-model"
        assert body["input"].startswith("Need mango")
        assert body["store"] is False
        assert body["text"]["format"]["strict"] is True
        return io.BytesIO(json.dumps({
            "status": "completed",
            "output": [
                {"type": "reasoning"},
                {"type": "message", "content": [{"type": "output_text", "text": json.dumps(output)}]},
            ],
        }).encode())

    monkeypatch.setattr(agent, "urlopen", fake_open)
    client = TestClient(app)
    request = {"text": "Need mango, 100.5 kg, under 5500 THB, prioritize price and require organic certification."}
    response = client.post(f"{BASE}/agent/interpret", json=request)
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "openai"
    assert data["draft"]["quantity_kg"] == "100.5"
    assert data["draft"]["preferences"]["price_weight"] == "100"
    assert data["draft"]["unsupported_constraints"] == ["Organic certification"]

    output["quantity_kg"] = -1
    assert client.post(f"{BASE}/agent/interpret", json=request).json()["draft"] is None


@pytest.mark.parametrize("outcome", ["refusal", "incomplete", "timeout", "malformed"])
def test_transport_failures_return_form_fallback(monkeypatch: pytest.MonkeyPatch, outcome: str) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")

    def fake_open(request: Request, timeout: float) -> io.BytesIO:
        if outcome == "timeout":
            raise TimeoutError
        if outcome == "malformed":
            return io.BytesIO(b"invalid JSON")
        return io.BytesIO(json.dumps({
            "status": "incomplete" if outcome == "incomplete" else "completed",
            "output": [{"type": "message", "content": [{"type": "refusal"}]}],
        }).encode())

    monkeypatch.setattr(agent, "urlopen", fake_open)
    response = TestClient(app).post(f"{BASE}/agent/interpret", json={"text": "mango"})
    assert response.status_code == 200
    assert response.json()["source"] == "deterministic"
    assert response.json()["draft"] is None


def test_missing_credentials_and_invalid_brief(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = TestClient(app)
    assert client.post(f"{BASE}/agent/interpret", json={"text": "mango"}).json()["source"] == "deterministic"
    assert client.post(f"{BASE}/agent/interpret", json={"text": "  "}).status_code == 422


def test_thai_brief_instructions_and_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    brief = "ขอสับปะรด ๘๕ กก. งบ ๓,๐๐๐ บาท"

    def unavailable(name: str, schema: dict[str, object], instructions: str, user_input: str) -> None:
        assert name == "buyer_order_draft"
        assert "Thai, English, or a mix" in instructions
        assert "descriptions in Thai" in instructions
        assert "Buddhist Era" in instructions
        assert user_input == brief

    monkeypatch.setattr(agent, "structured_response", unavailable)
    reply = TestClient(app).post(f"{BASE}/agent/interpret?lang=th", json={"text": brief}).json()
    assert reply["source"] == "deterministic"
    assert reply["draft"] is None
    assert "คุณกรอกเงื่อนไขในฟอร์ม" in reply["message"]


def test_explanations_use_only_known_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    evidence_id = "search_interest"
    monkeypatch.setattr(agent, "structured_response", lambda *args: {"evidence_ids": [evidence_id]})
    client = TestClient(app)
    trend = client.get(f"{BASE}/trends?fruit=mango&explain=true").json()
    assert trend["explanation_source"] == "openai"
    assert trend["explanation"].startswith("Search interest changed +29.17%")
    assert trend["score"] == 30.65

    evidence_id = "fabricated_price_forecast"
    invalid = client.get(f"{BASE}/trends?fruit=mango&explain=true").json()
    deterministic = client.get(f"{BASE}/trends?fruit=mango").json()
    assert invalid == deterministic

    evidence_id = "sunrise-mango:2"
    order = {
        "buyer_id": "demo-cafe-1", "fruit": "mango", "quantity_kg": 100,
        "delivery_by": (bangkok_today() + timedelta(days=7)).isoformat(),
    }
    basic = client.post(f"{BASE}/recommendations", json=order).json()
    explained = client.post(f"{BASE}/recommendations?explain=true", json=order).json()
    assert explained["explanation_source"] == "openai"
    assert "Sunrise Mango Farm" in explained["explanation"]
    assert explained["options"] == basic["options"]
