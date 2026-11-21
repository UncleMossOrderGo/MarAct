from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.idea_b.market_search import cited_context


def search_response(url: str) -> dict:
    return {"output": [
        {"type": "web_search_call", "status": "completed"},
        {"type": "message", "content": [{
            "type": "output_text", "text": "Report with a citation.",
            "annotations": [{"type": "url_citation", "title": "Report", "url": url,
                             "start_index": 0, "end_index": 6}],
        }]},
    ]}


def test_web_context_requires_completed_search_and_valid_citations() -> None:
    assert cited_context({"output": []}).status == "unavailable"
    invalid = cited_context(search_response("javascript:alert(1)"))
    assert invalid.status == "insufficient_evidence"
    assert invalid.summary is None
    result = cited_context(search_response("https://example.org/report"))
    assert result.status == "available"
    assert result.citations[0].url == "https://example.org/report"


def test_live_context_is_opt_in_and_mcp_failure_preserves_demo(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    client = TestClient(app)
    path = "/api/ideas/idea-b/trends?fruit=mango&lang=th"
    demo = client.get(path).json()
    assert "market_context" not in demo
    reply = client.get(path + "&web_search=true")
    assert reply.status_code == 200
    body = reply.json()
    assert body.pop("market_context")["status"] == "unavailable"
    assert body == demo
