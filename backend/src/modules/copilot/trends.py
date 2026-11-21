from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from backend.src.modules.copilot.language import Language, localized
from backend.src.modules.copilot.personalization import ExplanationSource, Fruit

SignalId = Literal["search_interest", "social_mentions"]
TrendLabel = Literal["rising", "steady", "falling", "insufficient_data"]


class Period(BaseModel):
    start: date
    end: date


class Source(BaseModel):
    source_id: str
    name: str
    collected_at: datetime
    geographic_scope: str
    metric_definition: str


class Signal(BaseModel):
    metric: SignalId
    current_value: int | None
    previous_value: int | None
    week_over_week_pct: float | None
    source_id: str


class FruitTrend(BaseModel):
    fruit: Fruit
    observed_period: Period
    comparison_period: Period
    signals: list[Signal]
    score: float | None
    trend_label: TrendLabel
    sources: list[Source]
    data_status: Literal["demo", "observed"] = "demo"
    explanation: str
    explanation_source: ExplanationSource = "deterministic"
    limitations: list[str]


CURRENT = Period(start=date(2026, 11, 9), end=date(2026, 11, 15))
PREVIOUS = Period(start=date(2026, 11, 2), end=date(2026, 11, 8))
COLLECTED_AT = datetime(2026, 11, 16, 2, tzinfo=UTC)
METRICS: tuple[SignalId, ...] = ("search_interest", "social_mentions")
DEFINITIONS: dict[SignalId, str] = {
    "search_interest": "Weekly search interest index from 0 to 100 on one scale across both weeks.",
    "social_mentions": "Weekly count of posts mentioning the fruit in the fixture.",
}
THAI_DEFINITIONS: dict[SignalId, str] = {
    "search_interest": "ดัชนีความสนใจจากการค้นหารายสัปดาห์ ตั้งแต่ 0 ถึง 100 โดยใช้สเกลเดียวกันทั้งสองสัปดาห์",
    "social_mentions": "จำนวนโพสต์ในข้อมูลจำลองที่กล่าวถึงผลไม้ชนิดนี้ในแต่ละสัปดาห์",
}
THAI_LABELS: dict[TrendLabel, str] = {
    "rising": "เพิ่มขึ้น", "steady": "ทรงตัว", "falling": "ลดลง", "insufficient_data": "ยังสรุปไม่ได้",
}
# Pairs are (previous week, observed week). None represents missing fixture coverage.
WEEKLY_SIGNALS: dict[Fruit, dict[SignalId, tuple[int | None, int | None]]] = {
    "mango": {"search_interest": (48, 62), "social_mentions": (140, 185)},
    "pineapple": {"search_interest": (59, 56), "social_mentions": (None, 72)},
}
LIMITATIONS = [
    "Synthetic Thailand data for a historical two-week demo. Interest alone cannot establish orders or future prices.",
    "The score is a heuristic. It averages the two percentage changes after limiting each to ±100 percentage points.",
    "Scores of +15 or higher are rising, scores of −15 or lower are falling, and scores in between are steady.",
]
THAI_LIMITATIONS = [
    "ข้อมูลจำลองของไทยย้อนหลังสองสัปดาห์ สัญญาณความสนใจอย่างเดียวไม่สามารถบอกยอดสั่งซื้อหรือราคาในอนาคตได้",
    "คะแนนมาจากค่าเฉลี่ยของเปอร์เซ็นต์การเปลี่ยนแปลงทั้งสองตัวชี้วัด โดยจำกัดค่าแต่ละตัวไว้ระหว่าง −100 ถึง +100",
    "คะแนนตั้งแต่ +15 คือความสนใจเพิ่มขึ้น คะแนน −15 หรือต่ำกว่าคือลดลง และค่าระหว่างนั้นคือทรงตัว",
]


def week_over_week(previous: int | None, current: int | None) -> Decimal | None:
    if previous is None or previous <= 0 or current is None:
        return None
    return Decimal(100 * (current - previous)) / previous


def score_changes(changes: list[Decimal]) -> tuple[float | None, TrendLabel]:
    if len(changes) != len(METRICS):
        return None, "insufficient_data"
    bounded = (max(Decimal(-100), min(change, Decimal(100))) for change in changes)
    average = sum(bounded, start=Decimal(0)) / len(METRICS)
    score = average.quantize(Decimal("0.01"))
    if score >= 15:
        return float(score), "rising"
    if score <= -15:
        return float(score), "falling"
    return float(score), "steady"


def fruit_trend(fruit: Fruit, lang: Language = "en") -> FruitTrend:
    signals = []
    sources = []
    changes = []
    for metric in METRICS:
        previous, current = WEEKLY_SIGNALS[fruit][metric]
        change = week_over_week(previous, current)
        if change is not None:
            changes.append(change)
        source_id = f"demo-th-{metric}"
        signals.append(Signal(
            metric=metric, current_value=current, previous_value=previous,
            week_over_week_pct=None if change is None else float(round(change, 2)),
            source_id=source_id,
        ))
        sources.append(Source(
            source_id=source_id, name=localized(lang, "MarAct Idea B synthetic interest fixture", "ข้อมูลความสนใจจำลองของ MarAct"),
            collected_at=COLLECTED_AT, geographic_scope=localized(lang, "Thailand", "ประเทศไทย"),
            metric_definition=localized(lang, DEFINITIONS[metric], THAI_DEFINITIONS[metric]),
        ))
    score, label = score_changes(changes)
    if label == "insufficient_data":
        explanation = localized(lang,
            "Both signals need two comparable weeks to score interest. "
            "Check seasonal supply, supplier lead times and shelf life before changing orders.",
            "ต้องมีข้อมูลทั้งสองตัวชี้วัดครบสองสัปดาห์จึงจะประเมินแนวโน้มได้ "
            "ก่อนปรับคำสั่งซื้อ ควรเช็กผลผลิตตามฤดูกาล ระยะเวลาจัดส่ง และอายุการเก็บรักษา",
        )
    else:
        explanation = localized(lang,
            f"Combined demo interest is {label}. Before changing order volumes, check seasonal availability "
            "and supplier lead times. A small trial order can limit spoilage if interest fades.",
            f"ความสนใจจากข้อมูลจำลอง{THAI_LABELS[label]} ก่อนปรับปริมาณสั่งซื้อควรเช็กผลผลิตตามฤดูกาลและระยะเวลาจัดส่ง "
            "การทดลองสั่งปริมาณน้อยช่วยลดความเสี่ยงผลไม้เสียหากความสนใจลดลง",
        )
    return FruitTrend(
        fruit=fruit, observed_period=CURRENT, comparison_period=PREVIOUS, signals=signals,
        score=score, trend_label=label, sources=sources, explanation=explanation,
        limitations=THAI_LIMITATIONS if lang == "th" else LIMITATIONS,
    )
