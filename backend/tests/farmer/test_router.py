from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.farmer import router


def test_farmer_workspace_on_shared_app(tmp_path, monkeypatch):
    monkeypatch.setattr(router, "ROOT", tmp_path)
    client = TestClient(app)
    assert client.get("/api/ideas/idea-d/workspace").status_code == 401
    assert client.post("/api/ideas/idea-d/session", json={"name":"test-farm","password":"test-password","register":True}).is_success
    state = client.get("/api/ideas/idea-d/workspace").json()
    assert state["profile"]["name"]
    assert state["listings"] == []
    response = client.put("/api/ideas/idea-d/profile", json={
        "revision": state["revision"], "profile": {**state["profile"], "name": "สวนทดสอบ"}
    })
    assert response.status_code == 200
    assert client.get("/api/ideas/idea-d/catalog").json()["profile"]["name"] == "สวนทดสอบ"
