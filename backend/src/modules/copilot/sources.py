from concurrent.futures import ThreadPoolExecutor

from backend.src.modules.copilot.language import Language
from backend.src.modules.copilot.market_search import market_context
from backend.src.modules.copilot.schemas import Opportunity, ToolCall


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
