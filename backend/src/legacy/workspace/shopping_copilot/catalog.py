from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from backend.src.modules.copilot.language import Language, localized
from backend.src.modules.copilot.personalization import FARMS, CatalogFruit, Farm
from backend.src.modules.copilot.schemas import (
    Product,
    SearchRequest,
    SearchResult,
    Strategy,
)

CENT = Decimal("0.01")
FRUITS: dict[CatalogFruit, tuple[str, ...]] = {
    "mango": ("มะม่วงน้ำดอกไม้", "Nam Dok Mai mango", "มะม่วง", "น้ำดอกไม้", "mango", "mangoes"),
    "pineapple": ("สับปะรด", "Pineapple", "สัปปะรด"),
    "banana": ("กล้วยหอม", "Banana", "กล้วย", "bananas"),
    "orange": ("ส้ม", "Orange", "oranges"),
}


@dataclass(frozen=True)
class BuyerProfile:
    business: Literal["smoothie", "retail"]
    fruits: tuple[CatalogFruit, ...]
    typical_kg: int
    typical_budget_thb: int
    preferred_farms: tuple[str, ...]
    prior_purchase: tuple[tuple[CatalogFruit, int], ...] = ()
    prior_product_subtotal_thb: int | None = None


PROFILES = {
    "buyer_demo_1": BuyerProfile("smoothie", ("mango", "banana"), 50, 5000, ("chanthaburi-orchard",),
                                (("mango", 50), ("banana", 30)), 3260),
    "buyer_demo_2": BuyerProfile("retail", ("pineapple", "orange"), 25, 4000, ("prachuap-pineapple",)),
}
WEIGHTS = {"price": .30, "preferred_farm": .35, "preferred_fruit": .20, "business_fit": .15}


def fruit_id(query: str) -> CatalogFruit | None:
    normalized = " ".join(query.casefold().split())
    return next((fruit for fruit, aliases in FRUITS.items()
                 if normalized in {fruit, *(alias.casefold() for alias in aliases)}), None)


def fruit_name(fruit: CatalogFruit, lang: Language) -> str:
    names = FRUITS[fruit]
    return localized(lang, names[1], names[0])


def product_total(farm: Farm, quantity: Decimal) -> Decimal:
    return (quantity * Decimal(farm.unit_satang) / 100).quantize(CENT, rounding=ROUND_HALF_UP)


def listing_id(farm: Farm) -> str:
    return f"{farm.farm_id}:{farm.fruit}"


def search(request: SearchRequest, today: date, lang: Language) -> SearchResult:
    sort: Strategy = "lowest_product_price" if request.sort_by == "lowest_product_price" else "personalized_relevance"
    profile = PROFILES.get(request.buyer_id) if request.mode == "personalized" else None
    preferred = request.preferred_farm_ids if request.preferred_farm_ids is not None else (
        profile.preferred_farms if profile else ()
    )
    fruit = fruit_id(request.fruit_query)
    if request.fruit_query and fruit is None:
        return SearchResult(items=[], sort_basis=sort, warnings=[
            localized(lang, "Fruit name is unknown. Try mango, pineapple, banana or orange.",
                      "ไม่รู้จักชื่อผลไม้นี้ ลองระบุมะม่วง สับปะรด กล้วย หรือส้ม"),
        ])
    if request.max_product_total_thb is not None and request.quantity_kg is None:
        return SearchResult(items=[], sort_basis=sort, warnings=[
            localized(lang, "Quantity is required to check a total product budget.", "ระบุปริมาณเพื่อเช็กงบรวมค่าสินค้า"),
        ])
    candidates = []
    for farm in FARMS:
        earliest = today + timedelta(days=farm.lead_days)
        quantity = request.quantity_kg
        total = product_total(farm, quantity) if quantity is not None else None
        if (fruit is not None and farm.fruit != fruit or farm.unit_satang < 0 or farm.stock_kg < farm.minimum_kg
                or quantity is not None and not farm.minimum_kg <= quantity <= farm.stock_kg
                or request.delivery_by is not None and earliest > request.delivery_by
                or request.max_product_total_thb is not None and total is not None
                and total > request.max_product_total_thb):
            continue
        candidates.append((farm, earliest, total))
    if not candidates:
        return SearchResult(items=[], sort_basis=sort, warnings=[
            localized(lang, "No listing satisfies stock, minimum order, delivery and product budget constraints.",
                      "ไม่มีรายการที่ตรงกับสต็อก ขั้นต่ำ วันส่ง และงบค่าสินค้าที่ระบุ"),
        ])
    low = min(farm.unit_satang for farm, _, _ in candidates)
    high = max(farm.unit_satang for farm, _, _ in candidates)
    products = []
    for farm, earliest, total in candidates:
        price = (high - farm.unit_satang) / (high - low) if high != low else 1.0
        in_stock = profile is not None and farm.minimum_kg <= profile.typical_kg <= farm.stock_kg
        typical_fits = bool(profile and in_stock and product_total(farm, Decimal(profile.typical_kg))
                            <= profile.typical_budget_thb)
        familiar = farm.farm_id in preferred
        preferred_fruit = bool(profile and farm.fruit in profile.fruits)
        score = (WEIGHTS["price"] * price + WEIGHTS["preferred_farm"] * familiar
                 + WEIGHTS["preferred_fruit"] * preferred_fruit + WEIGHTS["business_fit"] * typical_fits)
        reasons = [localized(lang, "Stock is available for the listing.", "รายการนี้มีสต็อกพร้อมขาย")]
        if familiar:
            reasons.append(localized(lang, "Matches your preferred farms.", "อยู่ในกลุ่มสวนที่คุณให้ความสำคัญ"))
        if preferred_fruit:
            reasons.append(localized(lang, "Matches your demo business profile.", "ตรงกับผลไม้ที่โปรไฟล์ร้านเดโมสนใจ"))
        if typical_fits:
            reasons.append(localized(lang, "Fits the demo profile’s typical quantity and budget.",
                                     "เข้าเงื่อนไขปริมาณและงบที่ร้านเดโมมักใช้"))
        if farm.unit_satang == low:
            reasons.append(localized(lang, "Lowest unit price among matching listings.", "ราคาต่อกิโลต่ำที่สุดในรายการที่ตรงเงื่อนไข"))
        products.append(Product(
            listing_id=listing_id(farm), farm_id=farm.farm_id, farm_name=localized(lang, farm.name, farm.name_th),
            fruit_id=farm.fruit, product_name=fruit_name(farm.fruit, lang),
            unit_price_thb=Decimal(farm.unit_satang) / 100, available_kg=farm.stock_kg,
            minimum_order_kg=farm.minimum_kg, earliest_delivery=earliest, quantity_kg=request.quantity_kg,
            estimated_product_total_thb=total,
            estimated_shipping_thb=None if farm.shipping_satang is None else Decimal(farm.shipping_satang) / 100,
            score=round(score, 4), reasons=reasons, warnings=[
                localized(lang, "Shipping is unknown.", "ยังไม่ทราบค่าขนส่ง"),
            ] if farm.shipping_satang is None else [],
        ))
    if sort == "lowest_product_price":
        products.sort(key=lambda item: (item.unit_price_thb, item.listing_id))
    else:
        products.sort(key=lambda item: (-item.score, item.unit_price_thb, item.listing_id))
    return SearchResult(items=products[:request.max_results], sort_basis=sort)
