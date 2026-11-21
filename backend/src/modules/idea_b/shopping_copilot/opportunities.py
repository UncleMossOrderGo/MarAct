from concurrent.futures import ThreadPoolExecutor
from datetime import date

from backend.src.modules.idea_b.language import Language, localized
from backend.src.modules.idea_b.market_search import market_context
from backend.src.modules.idea_b.personalization import Fruit
from backend.src.modules.idea_b.shopping_copilot.catalog import (
    PROFILES,
    fruit_name,
    search,
)
from backend.src.modules.idea_b.shopping_copilot.schemas import (
    Opportunities,
    Opportunity,
    SearchRequest,
    ToolCall,
)
from backend.src.modules.idea_b.trends import WEEKLY_SIGNALS, fruit_trend


def opportunities(buyer: str, today: date, lang: Language, only: Fruit | None = None) -> Opportunities:
    profile = PROFILES.get(buyer)
    results = []
    for fruit in WEEKLY_SIGNALS:
        if only is not None and fruit != only:
            continue
        listings = search(SearchRequest(buyer_id=buyer, fruit_query=fruit, max_results=20), today, lang).items
        if not listings:
            continue
        trend = fruit_trend(fruit, lang)
        signal = next(signal for signal in trend.signals if signal.metric == "search_interest")
        source = next(source for source in trend.sources if source.source_id == signal.source_id)
        reasons = []
        if profile and fruit in profile.fruits:
            reasons.append(localized(lang, "This fruit matches your demo shop's preferences.",
                                     "ผลไม้นี้ตรงกับความสนใจของร้านในโปรไฟล์เดโม"))
        if profile and any(item.minimum_order_kg <= profile.typical_kg <= item.available_kg for item in listings):
            reasons.append(localized(lang, "At least one listing fits your typical quantity.",
                                     "มีรายการที่รองรับปริมาณที่ร้านมักสั่ง"))
        results.append((bool(profile and fruit in profile.fruits), Opportunity(
            fruit_id=fruit, fruit_name=fruit_name(fruit, lang), signal_type=signal.metric, value=signal.week_over_week_pct,
            direction=trend.trend_label, observation_window=f"{trend.observed_period.start} / {trend.observed_period.end}",
            comparison_window=f"{trend.comparison_period.start} / {trend.comparison_period.end}",
            source_name=source.name, observed_at=source.collected_at, buyer_fit_reasons=reasons,
            matching_listing_ids=[item.listing_id for item in listings],
            caveat=localized(lang, "Demo signals do not predict sales or prices. Check shelf life and delivery before ordering.",
                             "สัญญาณเดโมไม่ทำนายยอดขายหรือราคา ควรเช็กอายุเก็บรักษาและวันส่งก่อนสั่งซื้อ"),
        )))
    results.sort(key=lambda pair: (not pair[0], pair[1].direction != "rising", pair[1].fruit_id))
    return Opportunities(opportunities=[opportunity for _, opportunity in results])


def attach_market_sources(items: list[Opportunity], lang: Language) -> list[ToolCall]:
    selected = items[:2]
    if not selected:
        return []
    with ThreadPoolExecutor(max_workers=len(selected)) as pool:
        pending = [(item, pool.submit(market_context, item.fruit_id, lang)) for item in selected]
        calls = []
        for item, future in pending:
            item.market_context = future.result()
            calls.append(ToolCall(name="search_fruit_market", fruit_id=item.fruit_id,
                                  status="error" if item.market_context.status == "unavailable" else "completed"))
    return calls
