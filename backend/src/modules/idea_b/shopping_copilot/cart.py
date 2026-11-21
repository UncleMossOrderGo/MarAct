from datetime import date
from decimal import Decimal

from backend.src.modules.idea_b.language import Language, localized
from backend.src.modules.idea_b.personalization import CatalogFruit
from backend.src.modules.idea_b.shopping_copilot.catalog import (
    fruit_id,
    fruit_name,
    search,
)
from backend.src.modules.idea_b.shopping_copilot.schemas import (
    CartPreview,
    CartRequest,
    Product,
    RequestedItem,
    SearchRequest,
    Unfulfilled,
)


def preview(request: CartRequest, today: date, lang: Language) -> CartPreview:
    quantities: dict[CatalogFruit, Decimal] = {}
    unfulfilled = []
    for item in request.items:
        fruit = fruit_id(item.fruit_query)
        if fruit is None:
            unfulfilled.append(Unfulfilled(item=item, reason=localized(
                lang, "Please specify a supported fruit.", "โปรดระบุชนิดผลไม้ที่อยู่ในแคตตาล็อก",
            )))
        else:
            quantities[fruit] = quantities.get(fruit, Decimal(0)) + item.quantity_kg
    choices: list[tuple[RequestedItem, list[Product]]] = []
    for fruit, quantity in quantities.items():
        # The per-item request limit also bounds combined identical lines.
        if quantity > Decimal("99999.99"):
            unfulfilled.extend(Unfulfilled(item=item, reason=localized(
                lang, "Combined quantity exceeds the supported range.", "ปริมาณรวมเกินช่วงที่ระบบรองรับ",
            )) for item in request.items if fruit_id(item.fruit_query) == fruit)
            continue
        item = RequestedItem(fruit_query=fruit_name(fruit, lang), quantity_kg=quantity)
        matches = search(SearchRequest(
            buyer_id=request.buyer_id, fruit_query=fruit, quantity_kg=quantity, delivery_by=request.delivery_by,
            preferred_farm_ids=request.preferred_farm_ids, max_results=20,
            sort_by="lowest_product_price" if request.optimization_goal == "lowest_product_price" else "relevance",
        ), today, lang)
        if not matches.items:
            unfulfilled.append(Unfulfilled(item=item, reason=matches.warnings[0]))
        else:
            choices.append((item, matches.items))

    cheapest = [min(cost(option) for option in options) for _, options in choices]
    subtotal = Decimal(0)
    selected = []
    for index, (item, options) in enumerate(choices):
        remaining = None if request.budget_thb is None else request.budget_thb - subtotal
        reserve = sum(cheapest[index + 1:], start=Decimal(0))
        feasible = [option for option in options if remaining is None or cost(option) <= remaining]
        if not feasible:
            unfulfilled.append(Unfulfilled(item=item, reason=localized(
                lang, "No eligible listing fits the remaining product budget.", "ไม่มีรายการที่อยู่ในงบค่าสินค้าที่เหลือ",
            )))
            continue
        option = next((option for option in feasible if remaining is None or cost(option) + reserve <= remaining),
                      min(feasible, key=cost))
        selected.append(option)
        subtotal += cost(option)
    shipping = [option.estimated_shipping_thb for option in selected]
    known_shipping = ([amount for amount in shipping if amount is not None]
                      if len({option.farm_id for option in selected}) == len(selected) else [])
    complete_shipping = bool(selected) and len(shipping) == len(known_shipping)
    if not selected:
        within = False
    elif request.budget_thb is None:
        within = None
    else:
        within = subtotal <= request.budget_thb
    return CartPreview(
        line_items=selected, product_subtotal_thb=subtotal,
        shipping_total_thb=sum(known_shipping, start=Decimal(0)) if complete_shipping else None,
        within_product_budget=within,
        remaining_product_budget_thb=None if request.budget_thb is None else request.budget_thb - subtotal,
        unfulfilled_items=unfulfilled, warnings=[
            localized(lang, "Budget covers products only; shipping and fees are separate.",
                      "งบในตะกร้านี้ใช้กับค่าสินค้าเท่านั้น ค่าขนส่งและค่าธรรมเนียมแยกต่างหาก"),
        ] + ([] if complete_shipping or not selected else [
            localized(lang, "Complete shipping total is unavailable.", "ยังคำนวณค่าขนส่งรวมไม่ได้"),
        ]),
    )


def cost(product: Product) -> Decimal:
    assert product.estimated_product_total_thb is not None
    return product.estimated_product_total_thb
