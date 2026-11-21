from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from backend.src.modules.idea_b.language import Language, localized, thai_date

Fruit = Literal["mango", "pineapple"]
Quantity = Annotated[Decimal, Field(gt=0, max_digits=7, decimal_places=2)]
Budget = Annotated[Decimal, Field(gt=0, max_digits=10, decimal_places=2)]
Weight = Annotated[Decimal, Field(ge=0, le=100, decimal_places=4)]
ExplanationSource = Literal["deterministic", "openai"]
DEMO_BUYER = "demo-cafe-1"
FARM_SOURCE = "MarAct Idea B synthetic farm catalog"
BANGKOK = timezone(timedelta(hours=7))


def bangkok_today() -> date:
    return datetime.now(BANGKOK).date()


def parse_delivery_date(value: object) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        parsed = date.fromisoformat(value)
        if value != parsed.isoformat():
            raise ValueError("Use YYYY-MM-DD for the delivery date.")
    else:
        raise PydanticCustomError("delivery_date_format", "Use YYYY-MM-DD for the delivery date.")
    if parsed < bangkok_today():
        raise ValueError("Delivery must be today or later in Bangkok.")
    return parsed


DeliveryDate = Annotated[date, BeforeValidator(parse_delivery_date)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Preferences(InputModel):
    price_weight: Weight = Decimal("0.45")
    quality_weight: Weight = Decimal("0.25")
    reliability_weight: Weight = Decimal("0.20")
    relationship_weight: Weight = Decimal("0.10")

    @model_validator(mode="after")
    def require_positive_weight(self) -> "Preferences":
        if not sum(self.weights()):
            raise ValueError("At least one priority must be greater than zero.")
        return self

    def weights(self) -> tuple[Decimal, ...]:
        return (
            self.price_weight,
            self.quality_weight,
            self.reliability_weight,
            self.relationship_weight,
        )


class RecommendationRequest(InputModel):
    buyer_id: str = Field(min_length=1, max_length=80)
    fruit: Fruit
    quantity_kg: Quantity
    delivery_by: DeliveryDate
    max_total_thb: Budget | None = None
    preferences: Preferences = Field(default_factory=Preferences)


class Availability(BaseModel):
    min_order_kg: int
    stock_kg: int
    earliest_delivery: date


class FarmOption(BaseModel):
    farm_id: str
    farm_name: str
    unit_price_thb: float
    subtotal_thb: float
    estimated_shipping_thb: float | None
    estimated_fees_thb: float | None
    total_cost_thb: float | None
    availability: Availability
    familiar: bool
    score: float
    reasons: list[str]
    tradeoffs: list[str]
    provenance: str = FARM_SOURCE
    missing_fields: list[str]


class Recommendations(BaseModel):
    data_status: Literal["demo"] = "demo"
    options: list[FarmOption]
    explanation: str
    explanation_source: ExplanationSource = "deterministic"


@dataclass(frozen=True)
class Farm:
    farm_id: str
    name: str
    name_th: str
    fruit: Fruit
    minimum_kg: int
    stock_kg: int
    lead_days: int
    unit_satang: int
    shipping_satang: int | None
    fees_satang: int | None
    quality: int
    reliability: int
    familiar_to: str | None = None


# Quality and reliability are illustrative catalog ratings on a 0–100 scale.
FARMS = (
    Farm("chanthaburi-orchard", "Chanthaburi Orchard", "สวนผลไม้จันทบุรี", "mango",
         25, 250, 1, 5_200, 27_000, 0, 93, 95, DEMO_BUYER),
    Farm("sunrise-mango", "Sunrise Mango Farm", "สวนมะม่วงซันไรส์", "mango",
         50, 600, 3, 4_000, 34_000, 2_000, 79, 78),
    Farm("orchard-korat", "Korat Family Orchard", "สวนครอบครัวโคราช", "mango",
         20, 130, 2, 4_400, None, 0, 85, 83),
    Farm("prachuap-pineapple", "Prachuap Pineapple Farm", "ไร่สับปะรดประจวบ", "pineapple",
         25, 420, 2, 2_500, 24_000, 0, 86, 80),
    Farm("sriracha-growers", "Si Racha Growers", "กลุ่มเกษตรกรศรีราชา", "pineapple",
         50, 250, 1, 2_950, 21_000, 0, 92, 90),
)


@dataclass(frozen=True)
class Quote:
    farm: Farm
    earliest_delivery: date
    subtotal: int
    total: int | None


def feasible_quotes(order: RecommendationRequest, today: date) -> list[Quote]:
    quotes = []
    for farm in FARMS:
        earliest = today + timedelta(days=farm.lead_days)
        if (farm.fruit != order.fruit or earliest > order.delivery_by
                or not farm.minimum_kg <= order.quantity_kg <= farm.stock_kg):
            continue
        subtotal = int((order.quantity_kg * farm.unit_satang).quantize(
            Decimal(1), rounding=ROUND_HALF_UP,
        ))
        total = (
            subtotal + farm.shipping_satang + farm.fees_satang
            if farm.shipping_satang is not None and farm.fees_satang is not None else None
        )
        if order.max_total_thb is not None and (total is None or total > order.max_total_thb * 100):
            continue
        quotes.append(Quote(farm, earliest, subtotal, total))
    return quotes


def farm_option(quote: Quote, score: Decimal, familiar: bool, lowest: int | None, lang: Language) -> FarmOption:
    farm = quote.farm
    reasons = [
        localized(lang, f"Can deliver from {quote.earliest_delivery.isoformat()}.",
                  f"ส่งได้ตั้งแต่ {thai_date(quote.earliest_delivery)}"),
        localized(lang, f"Demo quality rating {farm.quality}/100 and reliability rating {farm.reliability}/100.",
                  f"คะแนนจำลองด้านคุณภาพ {farm.quality}/100 และความน่าเชื่อถือ {farm.reliability}/100"),
    ]
    tradeoffs = []
    missing_fields = []
    if familiar:
        reasons.append(localized(lang, "Familiar supplier for this demo buyer.", "เป็นผู้ขายที่ผู้ซื้อในเดโมเคยใช้บริการ"))
    if quote.total is not None:
        if quote.total == lowest:
            reasons.append(localized(lang, "Lowest complete estimated total among matching farms.",
                                     "ยอดรวมโดยประมาณต่ำที่สุดในกลุ่มฟาร์มที่ระบุค่าใช้จ่ายครบ"))
        else:
            assert lowest is not None
            difference = f"{(quote.total - lowest) / 100:,.2f}"
            tradeoffs.append(localized(lang, f"฿{difference} above the lowest complete estimate.",
                                       f"สูงกว่ายอดรวมโดยประมาณที่ต่ำที่สุด {difference} บาท"))
    if farm.shipping_satang is None:
        missing_fields.append("estimated_shipping_thb")
        tradeoffs.append(localized(lang, "Shipping is unknown. Confirm it before comparing total costs.",
                                   "ยังไม่ทราบค่าขนส่ง ควรยืนยันก่อนเปรียบเทียบต้นทุนรวม"))
    if farm.fees_satang is None:
        missing_fields.append("estimated_fees_thb")
        tradeoffs.append(localized(lang, "Fees are unknown. Confirm them before comparing total costs.",
                                   "ยังไม่ทราบค่าธรรมเนียม ควรยืนยันก่อนเปรียบเทียบต้นทุนรวม"))
    return FarmOption(
        farm_id=farm.farm_id, farm_name=localized(lang, farm.name, farm.name_th),
        unit_price_thb=farm.unit_satang / 100, subtotal_thb=quote.subtotal / 100,
        estimated_shipping_thb=None if farm.shipping_satang is None else farm.shipping_satang / 100,
        estimated_fees_thb=None if farm.fees_satang is None else farm.fees_satang / 100,
        total_cost_thb=None if quote.total is None else quote.total / 100,
        availability=Availability(
            min_order_kg=farm.minimum_kg, stock_kg=farm.stock_kg,
            earliest_delivery=quote.earliest_delivery,
        ),
        familiar=familiar, score=float(round(score, 2)),
        reasons=reasons, tradeoffs=tradeoffs, missing_fields=missing_fields,
        provenance=localized(lang, FARM_SOURCE, "แคตตาล็อกฟาร์มจำลองของ MarAct"),
    )


def recommend(order: RecommendationRequest, today: date, lang: Language = "en") -> Recommendations:
    quotes = feasible_quotes(order, today)
    if not quotes:
        return Recommendations(
            options=[], explanation=localized(lang, "No demo farms match this quantity, delivery deadline and budget.",
                                              "ไม่พบฟาร์มในข้อมูลเดโมที่ตรงกับปริมาณ กำหนดส่ง และงบประมาณนี้"),
        )
    complete = [quote.total for quote in quotes if quote.total is not None]
    lowest = min(complete, default=None)
    highest = max(complete, default=None)
    weights = order.preferences.weights()
    ranked = []
    for quote in quotes:
        farm = quote.farm
        familiar = farm.familiar_to == order.buyer_id
        price = Decimal(0)
        if quote.total is not None and highest is not None and lowest is not None:
            price = Decimal(100) if highest == lowest else (
                Decimal(100 * (highest - quote.total)) / (highest - lowest)
            )
        criteria: tuple[Decimal | int, ...] = (price, farm.quality, farm.reliability, 100 if familiar else 0)
        contributions = (weight * criterion for weight, criterion in zip(weights, criteria, strict=True))
        score = sum(contributions, start=Decimal(0)) / sum(weights, start=Decimal(0))
        ranked.append((score, farm_option(quote, score, familiar, lowest, lang)))
    ranked.sort(key=lambda result: (-result[0], result[1].farm_id))
    explanation = localized(lang, "Matching farms are ranked by your priorities. Incomplete totals earn no price points.",
                            "จัดอันดับฟาร์มตามสิ่งที่คุณให้ความสำคัญ ฟาร์มที่ยังไม่ทราบยอดรวมจะไม่ได้คะแนนด้านราคา")
    return Recommendations(options=[option for _, option in ranked], explanation=explanation)
