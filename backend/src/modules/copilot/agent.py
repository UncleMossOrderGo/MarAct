import json
import os
from pathlib import Path
from typing import Annotated
from urllib.error import URLError
from urllib.request import Request, urlopen

from pydantic import Field, ValidationError

from backend.src.modules.copilot.language import Language, localized
from backend.src.modules.copilot.personalization import (
    Budget,
    DeliveryDate,
    ExplanationSource,
    Fruit,
    InputModel,
    Quantity,
    Recommendations,
    Weight,
    bangkok_today,
)
from backend.src.modules.copilot.trends import FruitTrend


class Brief(InputModel):
    text: str = Field(min_length=1, max_length=500)


class DraftPriorities(InputModel):
    price_weight: Weight | None
    quality_weight: Weight | None
    reliability_weight: Weight | None
    relationship_weight: Weight | None


class OrderDraft(InputModel):
    fruit: Fruit | None
    quantity_kg: Quantity | None
    delivery_by: DeliveryDate | None
    max_total_thb: Budget | None
    preferences: DraftPriorities
    unsupported_constraints: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(max_length=5)


class Interpretation(InputModel):
    source: ExplanationSource
    draft: OrderDraft | None
    message: str


def object_schema(properties: dict[str, object]) -> dict[str, object]:
    return {
        "type": "object", "properties": properties, "required": list(properties),
        "additionalProperties": False,
    }


NULLABLE_NUMBER = {"type": ["number", "null"]}
DRAFT_SCHEMA = object_schema({
    "fruit": {"type": ["string", "null"], "enum": ["mango", "pineapple", None]},
    "quantity_kg": NULLABLE_NUMBER,
    "delivery_by": {"type": ["string", "null"]},
    "max_total_thb": NULLABLE_NUMBER,
    "preferences": object_schema(dict.fromkeys(DraftPriorities.model_fields, NULLABLE_NUMBER)),
    "unsupported_constraints": {"type": "array", "items": {"type": "string"}},
})

SKILLS = Path(__file__).with_name("agent_skills")


def skill_instructions(name: str) -> str:
    return (SKILLS / name / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[-1].strip()


def create_response(payload: dict[str, object], timeout: int = 6) -> dict | None:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    model = os.getenv("OPENAI_MODEL", "").strip()
    if not api_key or not model:
        return None
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps({
            "model": model,
            "store": False,
            **payload,
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read(256_000))
        if isinstance(data, dict) and data.get("status") == "completed":
            return data
    except (URLError, OSError, ValueError, TypeError):
        pass
    return None


def structured_response(
    name: str, schema: dict[str, object], instructions: str, user_input: str,
) -> object | None:
    data = create_response({
        "instructions": instructions,
        "input": user_input,
        "max_output_tokens": 1_000,
        "text": {"format": {"type": "json_schema", "name": name, "strict": True, "schema": schema}},
    })
    try:
        if data is None:
            return None
        for item in data["output"]:
            if item.get("type") != "message":
                continue
            for part in item["content"]:
                if part["type"] == "refusal":
                    return None
                if part["type"] == "output_text":
                    return json.loads(part["text"])
    except (ValueError, KeyError, TypeError, AttributeError):
        return None
    return None


def interpret(brief: Brief, lang: Language = "en", *, allow_external: bool = True) -> Interpretation:
    response_language = localized(lang, "English", "Thai")
    raw = structured_response(
        "buyer_order_draft", DRAFT_SCHEMA,
        f"{skill_instructions('buyer-brief')}\nToday in Bangkok is {bangkok_today().isoformat()}. "
        f"Write constraint descriptions in {response_language}.",
        brief.text,
    ) if allow_external else None
    if raw is not None:
        try:
            draft = OrderDraft.model_validate(raw)
            return Interpretation(
                source="openai", draft=draft,
                message=localized(lang, "Review the suggested fields and any unresolved constraints before comparing farms.",
                                  "ตรวจข้อมูลที่ AI เสนอและเงื่อนไขที่ยังตรวจสอบไม่ได้ก่อนเปรียบเทียบฟาร์ม"),
            )
        except ValidationError:
            pass
    return Interpretation(
        source="deterministic", draft=None,
        message=localized(lang, "Order drafting is unavailable. Enter your requirements in the form to compare farms.",
                          "ตอนนี้ AI ร่างคำสั่งซื้อไม่ได้ คุณกรอกเงื่อนไขในฟอร์มเพื่อเปรียบเทียบฟาร์มได้เลย"),
    )


def select_evidence(evidence: dict[str, str]) -> str | None:
    choice = structured_response(
        "explanation_evidence",
        object_schema({"evidence_ids": {"type": "array", "items": {"type": "string", "enum": list(evidence)}}}),
        skill_instructions("local-evidence"),
        json.dumps(evidence, ensure_ascii=False),
    )
    if not isinstance(choice, dict):
        return None
    ids = choice.get("evidence_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 2:
        return None
    if not all(isinstance(item, str) and item in evidence for item in ids) or len(set(ids)) != len(ids):
        return None
    return " ".join(evidence[item] for item in ids)


def explain_recommendations(result: Recommendations) -> None:
    evidence = {
        f"{farm.farm_id}:{index}": f"{farm.farm_name} · {statement}"
        for farm in result.options
        for index, statement in enumerate(farm.reasons + farm.tradeoffs)
    }
    selected = select_evidence(evidence) if evidence else None
    if selected:
        result.explanation = f"{result.explanation} {selected}"
        result.explanation_source = "openai"


def explain_trend(result: FruitTrend, lang: Language = "en") -> None:
    evidence: dict[str, str] = {}
    metric_labels = {"search_interest": "Search interest", "social_mentions": "Social mentions"}
    metric_labels_th = {"search_interest": "ความสนใจจากการค้นหา", "social_mentions": "การกล่าวถึงบนโซเชียล"}
    for signal in result.signals:
        label = metric_labels[signal.metric]
        label_th = metric_labels_th[signal.metric]
        change = signal.week_over_week_pct
        evidence[signal.metric] = (
            localized(lang, f"{label} lacks a comparable week-over-week change in the demo.",
                      f"ข้อมูลเดโมด้าน{label_th}ไม่ครบสำหรับเปรียบเทียบรายสัปดาห์")
            if change is None else localized(lang, f"{label} changed {change:+.2f}% week over week in the demo.",
                                             f"{label_th}เปลี่ยนแปลง {change:+.2f}% เทียบกับสัปดาห์ก่อนในข้อมูลเดโม")
        )
    selected = select_evidence(evidence)
    if selected:
        result.explanation = f"{selected} {result.explanation}"
        result.explanation_source = "openai"
