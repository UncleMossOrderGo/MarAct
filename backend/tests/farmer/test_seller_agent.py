from unittest.mock import Mock, patch

from backend.src.modules.farmer import seller_agent
from backend.src.modules.farmer.domain import Fields
from backend.src.modules.farmer.router import blank
from backend.src.modules.farmer.seller_agent import Turn, apply_turn


def test_hypothetical_cannot_edit_fields_cover_or_pending_question():
    draft = blank()
    draft.update(fields=Fields(fruit="ชมพู่", stock_kg=48, unit="ลัง", kg_per_unit=8, price=320).model_dump(),
                 question="ยืนยันว่าจะเปลี่ยนน้ำหนักต่อลังไหมครับ?")
    answer = apply_turn(draft, Turn(intent="answer", reply="สองลัง 640 บาทครับ",
                        changes={"price": 640, "stock_kg": 16}, resolves_question=True, cover_number=2))
    assert answer.fields.model_dump() == draft["fields"]
    assert answer.question == draft["question"]
    assert answer.cover_number is None


def test_only_resolve_clarification_when_answered_and_clear_stale_unit_weight():
    draft = blank()
    draft.update(fields=Fields(price=35, unit="กก.").model_dump(), question="ราคานี้ขายต่อหน่วยไหนครับ?")
    other = apply_turn(draft, Turn(intent="update", changes={"area":"นนทบุรี"}, reply="ส่งนนทบุรีครับ"))
    assert other.question == draft["question"]
    answer = apply_turn(draft, Turn(intent="update", changes={"unit":"ลัง"}, resolves_question=True, reply="ต่อลังครับ"))
    assert answer.fields.price == 35 and answer.fields.kg_per_unit is None
    assert not answer.question


def test_model_receives_question_context_and_required_json_marker(monkeypatch):
    import json

    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    draft = blank()
    draft.update(fields=Fields(fruit="ชมพู่", stock_kg=48).model_dump(), photos=["pic"])
    draft["history"] = [{"role":"assistant", "text":"ตั้งราคาขายเท่าไหร่ครับ?"}]
    api = Mock()
    api.responses.create.return_value.output_text = '{"intent":"update","changes":{"price":320},"reply":"320 บาทครับ"}'
    with patch.object(seller_agent, "OpenAI", return_value=api):
        answer = seller_agent.interpret(draft, "320 ครับ")
    data = api.responses.create.call_args.kwargs
    assert data["store"] is False and "json" in data["input"].lower()
    context = json.loads(data["input"])
    assert context["next_missing"] == draft["history"][-1]["text"]
    assert context["photo_count"] == 1 and context["message"] == "320 ครับ"
    assert answer.fields.price == 320 and answer.fields.unit == "" and answer.fields.stock_kg == 48
