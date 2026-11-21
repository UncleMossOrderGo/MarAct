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
from backend.src.modules.idea_b.trends import FruitTrend, fruit_trend
from backend.src.shared.records import records_router

router = records_router(
    "SELECT id, title FROM idea_b_records ORDER BY id",
    "INSERT INTO idea_b_records (title) VALUES (%s) RETURNING id, title",
)


@router.post("/recommendations")
def recommendations(body: RecommendationRequest, explain: bool = False, lang: Language = "en") -> Recommendations:
    result = recommend(body, bangkok_today(), lang)
    if explain:
        explain_recommendations(result)
    return result


class TrendWithContext(FruitTrend):
    market_context: MarketContext


@router.get("/trends")
def trends(
    fruit: Fruit, explain: bool = False, lang: Language = "en", web_search: bool = False,
) -> FruitTrend | TrendWithContext:
    result = fruit_trend(fruit, lang)
    if explain:
        explain_trend(result, lang)
    if web_search:
        return TrendWithContext(**result.model_dump(), market_context=market_context(fruit, lang))
    return result


@router.post("/agent/interpret")
def interpret_brief(body: Brief, lang: Language = "en") -> Interpretation:
    return interpret(body, lang)
