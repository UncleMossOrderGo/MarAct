import json

from fastapi.testclient import TestClient

from backend.src.app.main import app
from backend.src.modules.idea_b.market_search import Citation, MarketContext
from backend.src.modules.idea_b.shopping_copilot import chat as copilot_chat
from backend.src.modules.idea_b.shopping_copilot import opportunities as trend_service

BASE = "/api/ideas/idea-b"
CLIENT = TestClient(app)


def test_personalized_rank_and_explicit_price_override() -> None:
    criteria = {"buyer_id": "buyer_demo_1", "fruit_query": "น้ำดอกไม้", "quantity_kg": 50}
    personalized = CLIENT.post(f"{BASE}/recommendations", json=criteria).json()
    cheapest = CLIENT.post(f"{BASE}/recommendations", json={
        **criteria, "sort_by": "lowest_product_price",
    }).json()
    assert personalized["items"][0]["farm_id"] == "chanthaburi-orchard"
    assert cheapest["items"][0]["farm_id"] == "sunrise-mango"
    assert cheapest["sort_basis"] == "lowest_product_price"
    generic = CLIENT.post(f"{BASE}/recommendations", json={**criteria, "buyer_id": "unknown"}).json()
    assert generic["items"][0]["farm_id"] == "sunrise-mango"
    assert not CLIENT.post(f"{BASE}/recommendations", json={**criteria, "fruit_query": "ผลไม้สีเหลือง"}).json()["items"]


def test_cart_accounts_for_moq_stock_unknown_shipping_and_budget() -> None:
    request = {
        "items": [
            {"fruit_query": "มะม่วง", "quantity_kg": "50.01"},
            {"fruit_query": "กล้วยหอม", "quantity_kg": 30},
            {"fruit_query": "ส้ม", "quantity_kg": 1},
            {"fruit_query": "สับปะรด", "quantity_kg": 999},
        ],
        "budget_thb": 2800,
    }
    result = CLIENT.post(f"{BASE}/smart-cart/preview", json=request).json()
    assert result["status"] == "proposal_only"
    assert result["requires_user_confirmation"] is True
    assert result["product_subtotal_thb"] == "2555.40"
    assert result["remaining_product_budget_thb"] == "244.60"
    assert result["within_product_budget"] is True
    assert result["shipping_total_thb"] is None
    assert len(result["unfulfilled_items"]) == 2
    for item in result["line_items"]:
        assert item["minimum_order_kg"] <= float(item["quantity_kg"]) <= item["available_kg"]
    empty = CLIENT.post(f"{BASE}/smart-cart/preview", json={
        "items": [{"fruit_query": "มะม่วง", "quantity_kg": 1}], "budget_thb": 100,
    }).json()
    assert empty["within_product_budget"] is False and not empty["line_items"]


def test_duplicate_cart_aliases_share_stock() -> None:
    result = CLIENT.post(f"{BASE}/smart-cart/preview", json={"items": [
        {"fruit_query": "มะม่วง", "quantity_kg": 350},
        {"fruit_query": "mango", "quantity_kg": 350},
    ]}).json()
    assert not result["line_items"]
    assert len(result["unfulfilled_items"]) == 1


def test_copilot_fallback_and_followup(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    chat_url = f"{BASE}/copilot/chat"
    first = CLIENT.post(chat_url, json={"message": "หามะม่วงน้ำดอกไม้ ๕๐ กก. ราคาถูกที่สุด"}).json()
    assert first["products"][0]["farm_id"] == "sunrise-mango"
    assert first["source"] == "deterministic"
    assert first["tool_calls"] == []
    second = CLIENT.post(chat_url, json={
        "message": "แล้วถ้าเป็นร้านผมควรซื้อสวนไหน", "previous_search": first["search_context"],
        "conversation_id": first["conversation_id"],
    }).json()
    assert second["products"][0]["farm_id"] == "chanthaburi-orchard"
    assert second["conversation_id"] == first["conversation_id"]
    basket = CLIENT.post(chat_url, json={"message": "จัดตะกร้ามะม่วง 50 โล กล้วย 30 โล งบ 5,000"}).json()
    assert len(basket["suggested_cart"]["line_items"]) == 2
    unsupported = CLIENT.post(chat_url, json={"message": "จัดตะกร้ามะม่วง 50 โล ทุเรียน 20 โล"}).json()
    assert unsupported["intent"] == "clarification"
    missing = CLIENT.post(chat_url, json={"message": "จัดตะกร้ามะม่วง 50 โล กับกล้วย"}).json()
    assert missing["intent"] == "clarification" and missing["suggested_cart"] is None
    unknown = CLIENT.post(chat_url, json={"buyer_id": "unknown", "message": "เหมือนที่ซื้อประจำ"}).json()
    assert unknown["suggested_cart"] is None


def test_openai_function_output_uses_authoritative_cart_and_server_identity(monkeypatch) -> None:
    calls = []

    def model(payload: dict, timeout: int) -> dict:
        calls.append(payload)
        if len(calls) == 1:
            return {"output": [{
                "type": "function_call", "name": "build_smart_cart", "call_id": "call_demo",
                "arguments": json.dumps({"buyer_id": "buyer_demo_2", "items": [
                    {"fruit_query": "mango", "quantity_kg": 50},
                ]}),
            }]}
        return {"output": [{"type": "message", "content": [{"text": "fabricated cart total"}]}]}

    monkeypatch.setattr(copilot_chat, "create_response", model)
    body = CLIENT.post(f"{BASE}/copilot/chat", json={"message": "จัดตะกร้ามะม่วง 50 โล"}).json()
    assert body["source"] == "openai"
    assert body["suggested_cart"]["line_items"][0]["farm_id"] == "chanthaburi-orchard"
    assert body["suggested_cart"]["product_subtotal_thb"] == "2600.00"
    assert calls[-1]["input"][-1]["type"] == "function_call_output"
    assert body["tool_calls"] == [{"name": "build_smart_cart", "status": "completed"}]
    assert "fabricated" not in body["message"]


def test_trends_are_personalized_and_link_only_catalog_inventory(monkeypatch) -> None:
    results = CLIENT.get(f"{BASE}/trends/opportunities?buyer_id=buyer_demo_2").json()
    assert results["data_mode"] == "demo_fixture"
    first = results["opportunities"][0]
    assert first["fruit_id"] == "pineapple"
    assert first["direction"] == "insufficient_data"
    assert first["source_name"] and first["observed_at"] and first["caveat"] and first["buyer_fit_reasons"]
    listings = CLIENT.post(f"{BASE}/recommendations", json={"fruit_query": first["fruit_id"]}).json()["items"]
    assert set(first["matching_listing_ids"]) == {item["listing_id"] for item in listings}
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    source = Citation(title="Market report", url="https://example.org/report", start_index=0, end_index=6)
    monkeypatch.setattr(trend_service, "market_context", lambda fruit, lang: MarketContext(
        status="available", summary="Recent market report.", citations=[source],
    ) if fruit == "mango" else MarketContext(status="insufficient_evidence"))
    response = CLIENT.post(f"{BASE}/copilot/chat", json={"message": "ผลไม้อะไรกำลังเป็นกระแสและเหมาะกับร้านผม"}).json()
    assert response["intent"] == "trend_discovery" and response["suggested_cart"] is None
    assert response["trend_opportunities"][0]["fruit_id"] == "mango"
    assert response["trend_opportunities"][0]["market_context"]["citations"][0]["url"] == source.url
    assert [call["fruit_id"] for call in response["tool_calls"] if call["name"] == "search_fruit_market"] == [
        "mango", "pineapple",
    ]


def test_unknown_fruit_and_unverified_claims_abstain(monkeypatch) -> None:
    def fail_if_called(*args, **kwargs):
        raise AssertionError("Unsupported facts should not call the model")

    monkeypatch.setattr(copilot_chat, "create_response", fail_if_called)
    for question in ("มีทุเรียนไหม", "ร้านไหนขายแก้วมังกร", "สวนมะม่วงนี้มีใบรับรอง GAP ไหม", "ประเทศไทยมีกี่จังหวัด"):
        body = CLIENT.post(f"{BASE}/copilot/chat", json={"message": question}).json()
        assert "ไม่มีข้อมูลเรื่องนี้ในฐานความรู้" in body["message"]
        assert not body["products"] and not body["tool_calls"]
        assert not body["trend_opportunities"] and body["suggested_cart"] is None
