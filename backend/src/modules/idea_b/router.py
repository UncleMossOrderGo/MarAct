import os

from backend.src.modules.idea_b.agent import (
    Brief,
    Interpretation,
    explain_recommendations,
    explain_trend,
    interpret,
)
from backend.src.modules.idea_b.language import Language
from backend.src.modules.idea_b.market_search import MarketContext, market_context
from backend.src.modules.idea_b.personalization import (
    Fruit,
    RecommendationRequest,
    Recommendations,
    bangkok_today,
    recommend,
)
from backend.src.modules.idea_b.shopping_copilot.cart import preview
from backend.src.modules.idea_b.shopping_copilot.catalog import search
from backend.src.modules.idea_b.shopping_copilot.chat import chat
from backend.src.modules.idea_b.shopping_copilot.opportunities import opportunities
from backend.src.modules.idea_b.shopping_copilot.schemas import (
    CartPreview,
    CartRequest,
    ChatRequest,
    ChatResponse,
    Opportunities,
    SearchRequest,
    SearchResult,
)
from backend.src.modules.idea_b.trends import FruitTrend, fruit_trend
from backend.src.shared.records import records_router

router = records_router(
    "SELECT id, title FROM idea_b_records ORDER BY id",
    "INSERT INTO idea_b_records (title) VALUES (%s) RETURNING id, title",
)


@router.post("/recommendations")
def recommendations(
    body: RecommendationRequest | SearchRequest, explain: bool = False, lang: Language = "en",
) -> Recommendations | SearchResult:
    if isinstance(body, SearchRequest):
        return search(body, bangkok_today(), lang)
    result = recommend(body, bangkok_today(), lang)
    if explain and os.getenv("MARACT_PUBLIC_DEMO") != "1":
        explain_recommendations(result)
    return result


@router.post("/copilot/chat")
def shopping_chat(body: ChatRequest, lang: Language = "th") -> ChatResponse:
    return chat(body, bangkok_today(), lang, allow_external=os.getenv("MARACT_PUBLIC_DEMO") != "1")


@router.post("/smart-cart/preview")
def smart_cart_preview(body: CartRequest, lang: Language = "th") -> CartPreview:
    return preview(body, bangkok_today(), lang)


@router.get("/trends/opportunities")
def trend_opportunities(buyer_id: str = "buyer_demo_1", lang: Language = "th") -> Opportunities:
    return opportunities(buyer_id, bangkok_today(), lang)


class TrendWithContext(FruitTrend):
    market_context: MarketContext


@router.get("/trends")
def trends(
    fruit: Fruit, explain: bool = False, lang: Language = "en", web_search: bool = False,
) -> FruitTrend | TrendWithContext:
    result = fruit_trend(fruit, lang)
    external = os.getenv("MARACT_PUBLIC_DEMO") != "1"
    if explain and external:
        explain_trend(result, lang)
    if web_search:
        return TrendWithContext(
            **result.model_dump(), market_context=market_context(fruit, lang) if external else MarketContext(status="unavailable"),
        )
    return result


@router.post("/agent/interpret")
def interpret_brief(body: Brief, lang: Language = "en") -> Interpretation:
    return interpret(body, lang, allow_external=os.getenv("MARACT_PUBLIC_DEMO") != "1")
