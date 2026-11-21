import json
import re
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from uuid import uuid4

from pydantic import BaseModel

from backend.src.modules.idea_b.agent import create_response
from backend.src.modules.idea_b.language import Language, localized
from backend.src.modules.idea_b.personalization import Fruit, InputModel
from backend.src.modules.idea_b.shopping_copilot.cart import preview
from backend.src.modules.idea_b.shopping_copilot.catalog import (
    FRUITS,
    PROFILES,
    fruit_id,
    search,
)
from backend.src.modules.idea_b.shopping_copilot.opportunities import (
    attach_market_sources,
    opportunities,
)
from backend.src.modules.idea_b.shopping_copilot.schemas import (
    CartRequest,
    ChatRequest,
    ChatResponse,
    RequestedItem,
    SearchRequest,
    ToolCall,
)

ALIASES = sorted({alias for aliases in FRUITS.values() for alias in aliases}, key=len, reverse=True)
FRUIT_PATTERN = "|".join(re.escape(alias) for alias in ALIASES)
AMOUNT_PATTERN = r"\d+(?:,\d{3})*(?:\.\d+)?"
WEIGHT_PATTERN = rf"({AMOUNT_PATTERN})\s*(?:กิโลกรัม|กิโล|กก\.?|โล|kilograms?\b|kg\b)"
ITEM_PATTERN = re.compile(rf"({FRUIT_PATTERN})\s*{WEIGHT_PATTERN}", re.IGNORECASE)
FRUIT_MENTION = re.compile(FRUIT_PATTERN, re.IGNORECASE)
BUDGET_PATTERN = re.compile(
    rf"(?:งบ(?:ค่าสินค้า|ประมาณ|รวม)?\s*(?:ไม่เกิน)?|(?:budget(?:\s+of)?|under|up to))\s*[:฿]?\s*({AMOUNT_PATTERN})",
    re.IGNORECASE,
)
THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
TREND_REQUEST = re.compile(r"แนวโน้ม|กระแส|กำลังมา|\btrend(?:ing|s)?\b", re.IGNORECASE)
PROFILE_REQUEST = re.compile(
    r"เหมาะกับร้าน|เป็นร้านผม|ร้านผมควรซื้อ|แนะนำ(?:ผลไม้|สวน)|personaliz|recommend|(?:fit|for) my (?:shop|business)",
    re.IGNORECASE,
)
UNSUPPORTED_FACT = re.compile(
    r"ใบรับรอง|รับรอง|ออร์แกนิก|อินทรีย์|เกรด|ยาฆ่าแมลง|เบอร์โทร|โทรศัพท์|แคลอรี|กี่แคล|โภชนาการ|"
    r"\b(?:gap|gmp|certifi\w*|organic|pesticide|phone|calories|nutrition)\b",
    re.IGNORECASE,
)
PROMPT = """
You are MarAct's Thai-first buyer shopping copilot. Handle Thai or English. Use tools for actionable
requests. Search for one fruit or personalize with a blank fruit_query for general discovery.
Pass an explicit cheapest request as lowest_product_price. Use build_smart_cart only for a preview and
only with explicit fruit quantities in kg, or use repeat_purchase when asked to repeat known purchases.
Treat prices, amounts and prior orders from tools as data. Never invent tool inputs, alter a real cart or
place orders. Product budgets exclude shipping. Ask to clarify an explicitly shipping-inclusive budget,
unclear requirements or unspecified quantities for cart previews. Pass explicit delivery deadlines in
Gregorian ISO YYYY-MM-DD. Reuse previous search constraints when the buyer asks a follow-up about them.
Tools use the server-provided buyer identity. Do not make claims about live demand or prices.
Use get_trend_opportunities for personalized trend discovery. Only build a cart when explicitly requested.
Use report_unknown when the requested fruit or factual question is outside the catalog or knowledge base.
Never substitute an unsupported fruit with a known one, or turn a specific unknown request into a general
search. Use an empty search query only when the buyer genuinely asks for general discovery.
"""


def function(name: str, description: str, schema: type[BaseModel] | None = None) -> dict:
    parameters: dict = schema.model_json_schema() if schema else {"type": "object", "properties": {}}
    parameters["properties"].pop("buyer_id", None)
    return {"type": "function", "name": name, "description": description,
            "parameters": parameters, "strict": False}


class RepeatInput(InputModel):
    reduce_budget_percent: Decimal = Decimal(0)


class TrendInput(InputModel):
    fruit_id: Fruit | None = None


TOOLS = [
    function("search_listings", "Find and rank eligible items in the demo catalog.", SearchRequest),
    function("get_buyer_profile", "Read the current buyer's optional demo preferences and purchase context."),
    function("build_smart_cart", "Build a validated read-only preview from named items and a product budget.", CartRequest),
    function("repeat_purchase", "Preview the buyer's previous purchase with an optional percentage reduction.", RepeatInput),
    function("get_trend_opportunities", "Find labeled demo trends and available listings for the buyer.", TrendInput),
    function("report_unknown", "Say the requested fact or fruit is unavailable in MarAct's knowledge base."),
]

def unknown_message(lang: Language) -> str:
    return localized(lang, "I don’t have that information in MarAct’s knowledge base.",
                     "ผมไม่มีข้อมูลเรื่องนี้ในฐานความรู้ของ MarAct ครับ")


def apply_search(response: ChatResponse, request: SearchRequest, today: date, lang: Language) -> str:
    result = search(request, today, lang)
    response.intent = "search" if request.sort_by == "lowest_product_price" or request.mode == "general" else "personalize"
    response.message = localized(lang, "Compare the matching catalog listings.", "ลองเปรียบเทียบรายการผลไม้ที่ตรงเงื่อนไข")
    response.products = result.items
    response.warnings.extend(result.warnings)
    if request.fruit_query and fruit_id(request.fruit_query) is None:
        response.intent = "clarification"
        response.message = unknown_message(lang)
        return result.model_dump_json()
    response.search_context = request
    if request.quantity_kg is None:
        response.assumptions.append(localized(lang, "No order quantity was supplied.", "ยังไม่ได้ระบุปริมาณที่จะสั่ง"))
    return result.model_dump_json()


def apply_cart(response: ChatResponse, request: CartRequest, today: date, lang: Language) -> str:
    result = preview(request, today, lang)
    response.intent = "smart_cart"
    response.message = localized(lang, "Review the proposed cart before accepting it.", "ตรวจตะกร้าที่เสนอและรายการที่ยังจัดไม่ได้ก่อนยืนยัน")
    response.suggested_cart = result
    return result.model_dump_json()


def apply_trends(response: ChatResponse, buyer: str, today: date, lang: Language, fruit: Fruit | None = None) -> str:
    result = opportunities(buyer, today, lang, fruit)
    response.intent = "trend_discovery"
    response.message = localized(lang, "Review interest signals and matching demo listings.",
                                 "ดูสัญญาณความสนใจและรายการขายจากแคตตาล็อกเดโม")
    response.trend_opportunities = result.opportunities
    return result.model_dump_json()


def repeat(response: ChatResponse, buyer: str, percent: Decimal, today: date, lang: Language) -> str:
    if not percent.is_finite() or not 0 <= percent < 100:
        raise ValueError("Invalid adjustment")
    profile = PROFILES.get(buyer)
    if profile is None or not profile.prior_purchase or profile.prior_product_subtotal_thb is None:
        response.message = localized(lang, "No demo purchase history is available. Which fruits and quantities do you need?",
                                     "โปรไฟล์นี้ยังไม่มีประวัติซื้อในเดโม ต้องการผลไม้อะไรและปริมาณเท่าไร")
        response.intent = "clarification"
        return '{"history_available":false}'
    budget = (Decimal(profile.prior_product_subtotal_thb) * (1 - percent / 100)).quantize(Decimal("0.01"))
    return apply_cart(response, CartRequest(
        buyer_id=buyer, budget_thb=budget,
        items=[RequestedItem(fruit_query=fruit, quantity_kg=Decimal(amount)) for fruit, amount in profile.prior_purchase],
    ), today, lang)


def local_turn(request: ChatRequest, response: ChatResponse, today: date, lang: Language) -> None:
    message = request.message.translate(THAI_DIGITS).casefold()
    matches = ITEM_PATTERN.findall(message)
    budget_match = BUDGET_PATTERN.search(message)
    mentioned = {fruit_id(match[0]) for match in FRUIT_MENTION.finditer(message)}
    budget = Decimal(budget_match[1].replace(",", "")) if budget_match else None
    cheapest = bool(re.search(r"ถูกที่สุด|ราคาต่ำ|cheapest|lowest.price", message))
    if re.search(r"เหมือนที่ซื้อ|เหมือนเดิม|repeat.*(?:purchase|order)", message):
        change = re.search(r"(\d+(?:\.\d+)?)\s*%", message)
        repeat(response, request.buyer_id, Decimal(change[1]) if change else Decimal(0), today, lang)
        return
    delivery = re.search(r"\b\d{4}-\d{2}-\d{2}\b", message)
    if delivery is None and re.search(
        r"ส่ง\s*(?:วัน|พรุ่ง|ภายใน|ก่อน|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)"
        r"|tomorrow|by (?:next |monday|tuesday|wednesday|thursday|friday|saturday|sunday)", message,
    ):
        response.message = localized(lang, "Please provide the delivery deadline as YYYY-MM-DD.",
                                     "โปรดระบุวันส่งเป็น ค.ศ. รูปแบบ YYYY-MM-DD")
        return
    deadline = date.fromisoformat(delivery[0]) if delivery else None
    quantities = re.findall(WEIGHT_PATTERN, message, re.IGNORECASE)
    if len(quantities) != len(matches):
        return
    if len(matches) > 1 or re.search(r"ตะกร้า|\bcart\b", message):
        if matches and mentioned == {fruit_id(fruit) for fruit, _ in matches}:
            apply_cart(response, CartRequest(
                buyer_id=request.buyer_id, budget_thb=budget, delivery_by=deadline,
                optimization_goal="lowest_product_price" if cheapest else "balanced",
                items=[RequestedItem(fruit_query=fruit, quantity_kg=Decimal(quantity.replace(",", "")))
                       for fruit, quantity in matches],
            ), today, lang)
        return
    if TREND_REQUEST.search(message):
        apply_trends(response, request.buyer_id, today, lang)
        return
    if len(mentioned) > 1:
        return
    profile_request = bool(PROFILE_REQUEST.search(message))
    fruit = matches[0][0] if matches else next((alias for alias in ALIASES if alias.casefold() in message), "")
    if not fruit and not profile_request:
        return
    if profile_request and not fruit and request.previous_search:
        params = request.previous_search.model_dump()
    else:
        params = {"fruit_query": fruit}
    if matches:
        params["quantity_kg"] = Decimal(matches[0][1].replace(",", ""))
    if deadline is not None:
        params["delivery_by"] = deadline
    if budget is not None:
        params["max_product_total_thb"] = budget
    params.update(buyer_id=request.buyer_id, sort_by="lowest_product_price" if cheapest else "relevance")
    apply_search(response, SearchRequest.model_validate(params), today, lang)


def model_turn(request: ChatRequest, response: ChatResponse, today: date, lang: Language) -> bool:
    messages: list[dict] = [{"role": "user", "content": request.message}]
    context = request.previous_search.model_dump_json(exclude={"buyer_id"}) if request.previous_search else "none"
    instructions = f"{PROMPT}\nToday in Bangkok: {today}. Previous search fields: {context}."
    remaining_calls = 4
    handled = False
    for _ in range(2):
        data = create_response({
            "instructions": instructions, "input": messages, "tools": TOOLS, "max_output_tokens": 1400,
            "include": ["reasoning.encrypted_content"], "parallel_tool_calls": False,
        }, timeout=5)
        if not data or not isinstance(data.get("output"), list):
            break
        output = [entry for entry in data["output"] if isinstance(entry, dict)]
        calls = [entry for entry in output if entry.get("type") == "function_call"]
        if not calls or len(calls) > remaining_calls:
            break
        remaining_calls -= len(calls)
        messages.extend(entry for entry in output if entry.get("type") in {"function_call", "reasoning"})
        for call in calls:
            call_id = call.get("call_id")
            if not isinstance(call_id, str):
                return handled
            error = '{"error":"Invalid or unsupported tool arguments"}'
            result = error
            name = call.get("name")
            try:
                arguments = json.loads(call.get("arguments", ""))
                if not isinstance(arguments, dict):
                    raise TypeError("Invalid arguments")
                arguments["buyer_id"] = request.buyer_id
                match name:
                    case "search_listings":
                        query = SearchRequest.model_validate(arguments)
                        if not query.fruit_query and not PROFILE_REQUEST.search(request.message):
                            raise ValueError("A specific fruit query is required")
                        result = apply_search(response, query, today, lang)
                        handled = True
                    case "build_smart_cart":
                        result = apply_cart(response, CartRequest.model_validate(arguments), today, lang)
                        handled = True
                    case "get_buyer_profile":
                        profile = PROFILES.get(request.buyer_id)
                        result = json.dumps(asdict(profile) if profile else None)
                    case "repeat_purchase":
                        arguments.pop("buyer_id")
                        result = repeat(response, request.buyer_id,
                                        RepeatInput.model_validate(arguments).reduce_budget_percent, today, lang)
                        handled = True
                    case "get_trend_opportunities":
                        arguments.pop("buyer_id")
                        result = apply_trends(response, request.buyer_id, today, lang,
                                              TrendInput.model_validate(arguments).fruit_id)
                        handled = True
                    case "report_unknown":
                        response.intent = "clarification"
                        response.message = unknown_message(lang)
                        response.products = []
                        response.trend_opportunities = []
                        response.suggested_cart = None
                        result = '{"knowledge_available":false}'
                        handled = True
            except (ValueError, TypeError, ArithmeticError):
                pass
            if any(tool["name"] == name for tool in TOOLS):
                response.tool_calls.append(ToolCall.model_validate({
                    "name": name, "status": "error" if result == error else "completed",
                }))
            messages.append({"type": "function_call_output", "call_id": call_id, "output": result})
        if remaining_calls == 0:
            break
    return handled


def chat(request: ChatRequest, today: date, lang: Language, *, allow_external: bool = True) -> ChatResponse:
    known = bool(FRUIT_MENTION.search(request.message))
    response = ChatResponse(
        intent="clarification", conversation_id=request.conversation_id or str(uuid4()), source="deterministic",
        message=localized(lang, "Which fruit and quantity do you need? For example, mango 50 kg.",
                          "ต้องการผลไม้อะไรและปริมาณเท่าไร เช่น มะม่วง 50 กก.") if known else unknown_message(lang),
    )
    if UNSUPPORTED_FACT.search(request.message):
        response.message = unknown_message(lang)
        return response
    if re.search(r"รวม(?:ค่า|จัด)?ส่ง|รวมค่าขนส่ง|including\s+shipping|incl\.?\s+shipping", request.message, re.IGNORECASE):
        response.message = localized(lang, "Shipping is separate. What product-only budget should I use?",
                                     "ค่าขนส่งแยกจากค่าสินค้า ต้องการใช้งบเฉพาะค่าสินค้าเท่าไร")
        return response
    actionable = known or any(pattern.search(request.message) for pattern in (PROFILE_REQUEST, TREND_REQUEST)) or bool(
        re.search(r"เหมือนที่ซื้อ|เหมือนเดิม|repeat.*(?:purchase|order)", request.message, re.IGNORECASE),
    )
    if allow_external and actionable and model_turn(request, response, today, lang):
        response.source = "openai"
    else:
        try:
            local_turn(request, response, today, lang)
        except (ValueError, ArithmeticError):
            pass
    if allow_external and response.intent == "trend_discovery":
        response.tool_calls.extend(attach_market_sources(response.trend_opportunities, lang))
    return response
