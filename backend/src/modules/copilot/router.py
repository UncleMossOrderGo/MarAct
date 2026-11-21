import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field

from backend.src.modules.copilot.agent import create_response
from backend.src.modules.copilot.language import THAI_DIGITS
from backend.src.modules.copilot.schemas import Opportunity, ToolCall
from backend.src.modules.copilot.sources import (
    attach_market_sources,
)
from backend.src.modules.copilot.trends import WEEKLY_SIGNALS, fruit_trend
from backend.src.modules.marketplace.catalog import (
    Basket,
    Pick,
    Postcode,
    quote,
    search_lots,
)
from backend.src.modules.marketplace.router import buyer, market

router = APIRouter()
QUERY = Annotated[str, Field(min_length=1, max_length=100)]
WEIGHT = Annotated[int, Field(ge=1, le=1_000_000)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Requested(Input):
    query: QUERY
    kg: WEIGHT | None = None


class Intent(Input):
    action: Literal["search", "cart", "trends", "unknown"]
    items: list[Requested] = Field(default_factory=list, max_length=10)
    sort: Literal["match", "cost", "date"] = "match"
    budget_thb: Annotated[int, Field(gt=0, le=100_000_000)] | None = None


class ChatInput(Input):
    message: Annotated[str, Field(min_length=1, max_length=600)]
    postcode: Postcode | None = None
    arrival: date | None = None
    preference: Annotated[str, Field(max_length=100)] = ""
    previous: Requested | None = None


class Group(BaseModel):
    farm: str
    lines: list[dict]
    freight: int | None = None
    total: int | None = None


class ChatReply(BaseModel):
    message: str
    source: Literal["openai", "deterministic"] = "deterministic"
    lots: list[dict] = Field(default_factory=list)
    groups: list[Group] = Field(default_factory=list)
    trends: list[Opportunity] = Field(default_factory=list)
    tool_calls: list[ToolCall] = Field(default_factory=list)
    unfulfilled: list[str] = Field(default_factory=list)
    previous: Requested | None = None
    delivery_confirmed: bool
    guest_mode: bool = False


FRUIT_ALIASES = {
    "mango": "มะม่วง", "nam dok mai": "มะม่วงน้ำดอกไม้", "passion fruit": "เสาวรส",
    "passionfruit": "เสาวรส", "pineapple": "สับปะรด", "banana": "กล้วย", "orange": "ส้ม",
    "durian": "ทุเรียน", "dragon fruit": "แก้วมังกร",
}
UNKNOWN = "ผมไม่มีข้อมูลที่ยืนยันเรื่องนี้ในตลาด MarAct ครับ"
UNSUPPORTED = re.compile(r"ใบรับรอง|ออร์แกนิก|อินทรีย์|แคลอรี|สารเคมี|\b(?:gap|organic|certification|calories)\b", re.IGNORECASE)
TREND = re.compile(r"แนวโน้ม|กระแส|กำลังมา|\btrend(?:ing|s)?\b", re.IGNORECASE)
QUANTITY = re.compile(r"(?<![\d.])(\d{1,7})\s*(?:กิโลกรัม|กิโล|กก\.?|โล|kg\b)", re.IGNORECASE)
BUDGET = re.compile(r"(?:งบ(?:รวม)?(?:ไม่เกิน)?|budget(?: of)?|under)\s*([\d,]+)", re.IGNORECASE)
POLICY = """
Interpret a MarAct buyer's Thai/English request. Call market_intent to search, propose a cart, show trends,
or acknowledge an unknown request. Use the actual requested fruit, farm or use in query, preserving unsupported
fruit names so inventory can verify them. Quantities must be whole kilograms. Prefer cost only when explicitly asked.
Only request cart when the buyer asks for a cart and supplies quantities. Never invent listing IDs or place orders.
For a new smoothie shop, search for the named fruit, not a beverage name. For a quantity-only follow-up,
retain the previously discussed fruit and use the new weight. Treat shop information as context only.
Use the previous search for an explicit follow-up. Do not use vague queries to answer specific factual questions.
"""


class QuotaExceeded(Exception):
    pass


def limit(name: str, default: int) -> int:
    value = os.getenv(name, str(default))
    return max(0, int(value)) if value.isdecimal() else default


def paid_turn(req: Request) -> bool:
    if not os.getenv("OPENAI_API_KEY") or not os.getenv("OPENAI_MODEL"):
        return False
    if os.getenv("MARACT_PUBLIC_DEMO") != "1":
        return True
    try:
        with req.app.state.pool.connection() as connection, connection.cursor(row_factory=dict_row) as cur:
            owner = buyer(cur, req)
            identity = hashlib.sha256(owner.encode()).hexdigest()
            ip = hashlib.sha256((req.client.host if req.client else "unknown").encode()).hexdigest()
            buckets = (
                (f"ip:{ip}", "minute", limit("MARACT_AI_IP_PER_MINUTE", 6)),
                (f"buyer:{identity}", "day", limit("MARACT_AI_BUYER_PER_DAY", 30)),
                ("global", "day", limit("MARACT_AI_GLOBAL_PER_DAY", 200)),
            )
            for bucket, period, maximum in buckets:
                row = cur.execute(
                    """INSERT INTO market_copilot_quota VALUES (%s, date_trunc(%s, now(), 'UTC'), 1)
                       ON CONFLICT (bucket, starts_at) DO UPDATE SET turns=market_copilot_quota.turns+1
                       WHERE market_copilot_quota.turns < %s RETURNING turns""",
                    (bucket, period, maximum),
                ).fetchone() if maximum else None
                if row is None:
                    raise QuotaExceeded
            cur.execute("DELETE FROM market_copilot_quota WHERE starts_at < now() - interval '2 days'")
            return True
    except (HTTPException, QuotaExceeded):
        return False


def model_intent(body: ChatInput, business: str = "") -> Intent | None:
    data = create_response({
        "instructions": POLICY,
        "input": json.dumps({**body.model_dump(mode="json"), "shop_business": business}, ensure_ascii=False),
        "tools": [{"type": "function", "name": "market_intent", "description": "Use verified stock and quote tools",
                   "strict": False, "parameters": Intent.model_json_schema()}],
        "tool_choice": "required", "parallel_tool_calls": False, "max_output_tokens": 1000,
    }, timeout=7)
    for item in data.get("output", []) if data else []:
        if item.get("type") == "function_call" and item.get("name") == "market_intent":
            try:
                return Intent.model_validate_json(item.get("arguments", ""))
            except (ValueError, TypeError):
                return None
    return None


def local_intent(body: ChatInput, names: list[str]) -> Intent:
    text = body.message.translate(THAI_DIGITS).casefold()
    sort: Literal["match", "cost", "date"] = "cost" if re.search(r"ถูก|cheapest|lowest", text) else "date" if "ส่งเร็ว" in text else "match"
    budget = BUDGET.search(text)
    candidates = sorted(set(names + list(FRUIT_ALIASES) + list(FRUIT_ALIASES.values())), key=lambda name: (-len(name), name))
    pattern = "|".join(re.escape(name.casefold()) for name in candidates if name)
    matches = list(re.finditer(pattern, text)) if pattern else []
    items: list[Requested] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        amount = QUANTITY.search(text, match.end(), end)
        item = Requested(query=FRUIT_ALIASES.get(match[0], match[0]), kg=int(amount[1]) if amount else None)
        previous = next((existing for existing in items if existing.query == item.query), None)
        if previous is not None and (previous.kg is None or item.kg is None):
            previous.kg = previous.kg or item.kg
        else:
            items.append(item)
    if TREND.search(text):
        if not items and not re.search(r"ผลไม้|\bfruits?\b|^(?:แนวโน้ม|กระแส|trends?)\s*$", text):
            return Intent(action="unknown")
        return Intent(action="trends", items=items)
    followup = re.fullmatch(r"(?:งั้นขอ|งั้น|เอา|ขอ|เริ่มที่|เริ่มจาก|ต้องการ)?\s*(\d{1,7})\s*(?:กิโลกรัม|กิโล|กก\.?|โล|kg)(?:\s*(?:ครับ|ค่ะ|นะครับ|นะคะ|ราคาถูกที่สุด|ขอถูกที่สุด|ถูกที่สุด))*[ ?!]*", text)
    if not items and body.previous and followup:
        items = [Requested(query=body.previous.query, kg=int(followup[1]))]
    if not items and body.previous and re.search(r"^(?:แล้วมี(?:แบบ|ตัวเลือก)?ถูกกว่า|อันเดิม|ถูกกว่านี้|cheaper|same)\b", text):
        items = [body.previous]
    budget_thb = int(budget[1].replace(",", "")) if budget else None
    if re.search(r"ตะกร้า|\bcart\b", text) or len(items) > 1:
        if not items or any(item.kg is None for item in items) or len(QUANTITY.findall(text)) > len(items):
            return Intent(action="unknown")
        return Intent(action="cart", items=items, sort=sort, budget_thb=budget_thb)
    return Intent(action="search", items=items, sort=sort, budget_thb=budget_thb) if items else Intent(action="unknown")


def available(cur, item: Requested, body: ChatInput, sort: str) -> list[dict]:
    rows = search_lots(cur, q=item.query, kg=item.kg, postcode=body.postcode,
                      arrival=body.arrival, sort=sort, preference=body.preference)
    return [row for row in rows if not row["misses"]]


def prepare(cur, intent: Intent, body: ChatInput, reply: ChatReply, business: str = "") -> None:
    if intent.action == "search" and intent.items:
        item = intent.items[0]
        candidates = available(cur, item, body, intent.sort)
        reply.lots = [row for row in candidates if intent.budget_thb is None
                      or row["units"] * row["price"] <= intent.budget_thb][:5]
        if reply.lots:
            reply.previous = item
            reply.message = "พบล็อตที่ตรงกับคำขอครับ"
            if any(word in business + body.message for word in ("ปั่น", "สมูท", "smoothie")):
                suited = next((row for row in reply.lots if any(word in row["uses"].casefold()
                              for word in ("ปั่น", "สมูท", "smoothie", "น้ำผลไม้"))), None)
                if suited:
                    reply.message = (f"สำหรับร้านน้ำปั่น ลองดู{suited['name']}จาก{suited['farm']}ครับ "
                                     f"สวนระบุว่าใช้ทำ {suited['uses']} ราคา {suited['price']:,} บาทต่อ{suited['unit']} "
                                     f"สั่งขั้นต่ำ {suited['minimum']} {suited['unit']}")
                if item.kg is None:
                    reply.message += " รอบแรกอยากลองกี่กิโลครับ? ผมจะเทียบยอดให้ตามจำนวนที่ใช้"
    elif intent.action == "cart" and intent.items:
        choices: dict[str, list[dict]] = defaultdict(list)
        seen = set()
        subtotal = 0
        for item in intent.items:
            if item.kg is None:
                reply.unfulfilled.append(item.query)
                continue
            for row in available(cur, item, body, intent.sort):
                products = row["units"] * row["price"]
                if row["id"] in seen or intent.budget_thb is not None and subtotal + products > intent.budget_thb:
                    continue
                seen.add(row["id"])
                choices[row["farm"]].append(row)
                subtotal += products
                break
            else:
                reply.unfulfilled.append(item.query)
        for farm, lines in choices.items():
            group = Group(farm=farm, lines=lines)
            if body.postcode and body.arrival:
                offer = quote(cur, Basket(postcode=body.postcode, arrival=body.arrival, lines=[
                    Pick(id=row["id"], units=row["units"], requested_kg=row["requested_kg"]) for row in lines
                ]))
                group.freight, group.total = offer["freight"], offer["total"]
            reply.groups.append(group)
        if reply.groups:
            reply.message = "ตรวจรายการที่เสนอได้ด้านล่าง งบที่ระบุใช้กับค่าสินค้าครับ"
    elif intent.action == "trends":
        for fruit in WEEKLY_SIGNALS:
            label = FRUIT_ALIASES[fruit]
            if intent.items and not any(label in FRUIT_ALIASES.get(item.query.casefold(), item.query) for item in intent.items):
                continue
            rows = available(cur, Requested(query=label), body, "match")
            if not rows:
                continue
            trend = fruit_trend(fruit, "th")
            signal = next(signal for signal in trend.signals if signal.metric == "search_interest")
            source = next(source for source in trend.sources if source.source_id == signal.source_id)
            reply.trends.append(Opportunity(
                fruit_id=fruit, fruit_name=label, signal_type=signal.metric, value=signal.week_over_week_pct,
                direction=trend.trend_label, observation_window=f"{trend.observed_period.start} / {trend.observed_period.end}",
                comparison_window=f"{trend.comparison_period.start} / {trend.comparison_period.end}",
                source_name=source.name, observed_at=source.collected_at,
                buyer_fit_reasons=["ตรงกับความสนใจที่ระบุ"] if any(row["preferred"] for row in rows) else [],
                matching_listing_ids=[row["id"] for row in rows],
                caveat="สัญญาณเดโมไม่ยืนยันยอดสั่งซื้อหรือราคาในอนาคต",
            ))
        if reply.trends:
            reply.trends.sort(key=lambda trend: (not trend.buyer_fit_reasons, trend.direction != "rising", trend.fruit_id))
            reply.message = "นี่คือสัญญาณเดโมที่เชื่อมกับล็อตพร้อมขายในตลาด"


@router.post("/copilot/chat")
def market_chat(body: ChatInput, req: Request) -> ChatReply:
    reply = ChatReply(message=UNKNOWN, delivery_confirmed=bool(body.postcode and body.arrival))
    reply.guest_mode = os.getenv("MARACT_PUBLIC_DEMO") == "1" and not req.cookies.get("market_session")
    if UNSUPPORTED.search(body.message):
        return reply
    normalized = body.message.translate(THAI_DIGITS)
    if re.search(r"รวม(?:ค่า|จัด)?ส่ง|รวมค่าขนส่ง|including shipping", normalized, re.IGNORECASE):
        reply.message = "งบที่ใช้กรองตะกร้าคืองบค่าสินค้า กรุณาระบุงบค่าสินค้า แล้วตรวจยอดส่งถึงจากใบเสนอราคาครับ"
        return reply
    if re.search(r"\d+\.\d+\s*(?:กก|โล|kg|กิโล)", normalized, re.IGNORECASE):
        reply.message = "ตลาดรับเป้าหมายเป็นกิโลกรัมเต็มจำนวน กรุณาระบุปริมาณใหม่ครับ"
        return reply
    allowed = paid_turn(req)
    business = ""
    if req.cookies.get("market_session"):
        with market(req) as cur:
            try:
                owner = buyer(cur, req)
            except HTTPException as exc:
                if exc.status_code != 401:
                    raise
            else:
                cur.execute("SELECT business FROM idea_c_buyers WHERE name=%s", (owner,))
                business = cur.fetchone()["business"]
    intent = model_intent(body, business) if allowed else None
    with market(req) as cur:
        if intent is None:
            cur.execute("SELECT DISTINCT name, farm FROM idea_c_lots")
            names = [value for row in cur.fetchall() for value in (row["name"], row["farm"])]
            try:
                intent = local_intent(body, names)
            except ValueError:
                return reply
        else:
            reply.source = "openai"
            reply.tool_calls.append(ToolCall(name="market_intent", status="completed"))
        prepare(cur, intent, body, reply, business)
        if intent.action == "search":
            reply.tool_calls.append(ToolCall(name="search_listings", status="completed"))
        elif intent.action == "cart":
            reply.tool_calls.append(ToolCall(name="build_smart_cart", status="completed"))
        elif intent.action == "trends":
            reply.tool_calls.append(ToolCall(name="get_trend_opportunities", status="completed"))
    if allowed and reply.trends:
        reply.tool_calls.extend(attach_market_sources(reply.trends, "th"))
    if not reply.delivery_confirmed and (reply.lots or reply.groups):
        reply.message += " ระบุรหัสไปรษณีย์กับวันรับเพื่อเช็กการส่งและยอดส่งถึง"
    return reply
