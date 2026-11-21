from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import TypedDict
from zoneinfo import ZoneInfo

from psycopg import Connection, Cursor
from psycopg.types.json import Jsonb

BANGKOK = ZoneInfo("Asia/Bangkok")
SMOOTHIE_SHOP_ID = "demo"
SEED_TREND_RUN_ID = "marketplace-demo-trend"

SHOPS = (
    (SMOOTHIE_SHOP_ID, "Smoothie Café", "smoothie", ["smoothie", "tropical"]),
    ("bakery", "Bakery", "bakery", ["baking", "dessert"]),
    ("cafe", "Café", "cafe", ["drinks", "dessert"]),
)
FRUITS = (
    ("mango", "Mango", "มะม่วง", ["smoothie", "tropical", "dessert"]),
    ("pineapple", "Pineapple", "สับปะรด", ["smoothie", "tropical", "drinks"]),
    ("banana", "Banana", "กล้วย", ["smoothie", "baking"]),
    ("strawberry", "Strawberry", "สตรอว์เบอร์รี", ["baking", "dessert"]),
    ("orange", "Orange", "ส้ม", ["drinks", "dessert"]),
    ("dragon-fruit", "Dragon Fruit", "แก้วมังกร", ["tropical", "smoothie"]),
)
SELLERS = (
    ("orchard", "Orchard Direct", "Nakhon Pathom", Decimal("4.8")),
    ("market", "Morning Fruit Market", "Bangkok", Decimal("4.6")),
    ("harvest", "Harvest Wholesale", "Pathum Thani", Decimal("4.7")),
)
LISTINGS = (
    ("mango-orchard", "orchard", "mango", Decimal("78.00"), 36),
    ("mango-market", "market", "mango", Decimal("92.00"), 24),
    ("pineapple-harvest", "harvest", "pineapple", Decimal("45.00"), 18),
    ("banana-market", "market", "banana", Decimal("35.00"), 20),
    ("strawberry-orchard", "orchard", "strawberry", Decimal("150.00"), 10),
    ("orange-harvest", "harvest", "orange", Decimal("65.00"), 16),
    ("dragon-fruit-market", "market", "dragon-fruit", Decimal("58.00"), 12),
)
DAILY_USAGE = (
    (SMOOTHIE_SHOP_ID, "mango", 8),
    (SMOOTHIE_SHOP_ID, "banana", 4),
    (SMOOTHIE_SHOP_ID, "pineapple", 3),
    ("bakery", "banana", 7),
    ("bakery", "strawberry", 5),
    ("bakery", "mango", 2),
    ("cafe", "orange", 7),
    ("cafe", "strawberry", 4),
    ("cafe", "mango", 3),
)
MANGO_SOURCES = [
    {
        "url": "https://www.tourismthailand.org/Restaurant/k-panich",
        "title": "Tourism Authority of Thailand · K. Panich",
    },
]


def seed_marketplace(connection: Connection, planning_date: date) -> None:
    """Insert the demo fixtures inside the caller's transaction."""
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO idea_a_shops (id, name, category, menu_tags)
            VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING
            """,
            [
                (shop_id, name, category, Jsonb(tags))
                for shop_id, name, category, tags in SHOPS
            ],
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_fruits (id, name_en, name_th, tags)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET name_th = EXCLUDED.name_th, tags = EXCLUDED.tags
            WHERE idea_a_fruits.name_th = idea_a_fruits.name_en AND idea_a_fruits.tags = '[]'
            """,
            [
                (fruit_id, name_en, name_th, Jsonb(tags))
                for fruit_id, name_en, name_th, tags in FRUITS
            ],
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_sellers (id, name, area, rating)
            VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING
            """,
            SELLERS,
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_listings (id, seller_id, fruit_id, price_per_kg_thb, stock_kg, active)
            VALUES (%s, %s, %s, %s, %s, TRUE) ON CONFLICT DO NOTHING
            """,
            LISTINGS,
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_usage (shop_id, fruit_id, usage_date, quantity_kg)
            VALUES (%s, %s, %s, %s) ON CONFLICT (shop_id, fruit_id, usage_date) DO NOTHING
            """,
            [
                (shop_id, fruit_id, planning_date - timedelta(days=days_ago), daily_kg)
                for shop_id, fruit_id, daily_kg in DAILY_USAGE
                for days_ago in range(1, 8)
            ],
        )
        timestamp = datetime.combine(planning_date, time.min, BANGKOK)
        cursor.execute(
            """
            INSERT INTO idea_a_trend_runs (id, started_at, finished_at, status, source)
            VALUES (%s, %s, %s, 'fallback', 'seed') ON CONFLICT (id) DO NOTHING
            """,
            (SEED_TREND_RUN_ID, timestamp, timestamp),
        )
        confidence = Decimal("0.85")
        mention_count = len(MANGO_SOURCES)
        score = Decimal("0.6") * confidence + Decimal("0.4") * min(mention_count, 5) / 5
        cursor.execute(
            """
            INSERT INTO idea_a_trends
                (run_id, fruit_id, trend_name, rationale, related_menus, confidence,
                 mention_count, score, sources)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (run_id, fruit_id) DO NOTHING
            """,
            (
                SEED_TREND_RUN_ID,
                "mango",
                "Mango Sticky Rice",
                "Thailand’s tourism authority profiles Bangkok mango sticky rice.",
                Jsonb(["Mango sticky rice", "Mango smoothie"]),
                confidence,
                mention_count,
                score,
                Jsonb(MANGO_SOURCES),
            ),
        )


DEFAULT_DAILY_SHOP_ID = "bakery-main"
DAILY_SHOPS = (
    (DEFAULT_DAILY_SHOP_ID, "MarAct Bakery", "bakery"),
    ("bakery-west", "West Bakery", "bakery"),
    ("cafe-main", "MarAct Café", "cafe"),
    ("cafe-west", "West Café", "cafe"),
    ("juice-main", "MarAct Juice", "juice_shop"),
    ("juice-west", "West Juice", "juice_shop"),
)
DAILY_INGREDIENTS = (
    (
        "pistachio-paste",
        "Pistachio Paste",
        "เพสต์พิสตาชิโอ",
        "baking",
        ["pistachio butter", "พิสตาชิโอบด"],
    ),
    ("whipping-cream", "Whipping Cream", "วิปปิ้งครีม", "dairy", ["heavy cream", "ครีมสด"]),
    ("milk", "Milk", "นมสด", "dairy", ["whole milk", "นม"]),
    ("strawberry", "Strawberry", "สตรอว์เบอร์รี", "fruit", ["strawberries", "สตรอเบอร์รี่"]),
    ("mango", "Mango", "มะม่วง", "fruit", ["ripe mango", "มะม่วงสุก"]),
    ("flour", "Cake Flour", "แป้งเค้ก", "baking", ["pastry flour"]),
    ("sugar", "Sugar", "น้ำตาล", "baking", ["granulated sugar"]),
    ("butter", "Butter", "เนย", "dairy", ["unsalted butter"]),
    ("vanilla", "Vanilla", "วานิลลา", "baking", ["vanilla extract"]),
    ("cocoa", "Cocoa Powder", "ผงโกโก้", "baking", ["cacao powder"]),
    ("matcha", "Matcha", "มัทฉะ", "beverage", ["green tea powder"]),
    ("banana", "Banana", "กล้วย", "fruit", ["bananas"]),
    ("pineapple", "Pineapple", "สับปะรด", "fruit", ["pineapples"]),
    ("orange", "Orange", "ส้ม", "fruit", ["oranges"]),
    ("dragon-fruit", "Dragon Fruit", "แก้วมังกร", "fruit", ["pitaya"]),
    ("coconut", "Coconut", "มะพร้าว", "fruit", ["young coconut"]),
    ("lemon", "Lemon", "เลมอน", "fruit", ["lemons"]),
    ("raspberry", "Raspberry", "ราสป์เบอร์รี", "fruit", ["raspberries"]),
    ("blueberry", "Blueberry", "บลูเบอร์รี", "fruit", ["blueberries"]),
    ("avocado", "Avocado", "อะโวคาโด", "fruit", ["avocados"]),
    ("lychee", "Lychee", "ลิ้นจี่", "fruit", ["litchi"]),
    ("passion-fruit", "Passion Fruit", "เสาวรส", "fruit", ["passionfruit"]),
    ("yogurt", "Yogurt", "โยเกิร์ต", "dairy", ["plain yogurt"]),
    (
        "condensed-milk",
        "Condensed Milk",
        "นมข้นหวาน",
        "dairy",
        ["sweetened condensed milk"],
    ),
    ("cream-cheese", "Cream Cheese", "ครีมชีส", "dairy", ["soft cheese"]),
    ("almond", "Almond", "อัลมอนด์", "baking", ["almonds"]),
    ("oat", "Rolled Oats", "ข้าวโอ๊ต", "baking", ["oats"]),
    ("honey", "Honey", "น้ำผึ้ง", "sweetener", ["raw honey"]),
    ("coffee", "Coffee Beans", "เมล็ดกาแฟ", "beverage", ["coffee"]),
    ("black-tea", "Black Tea", "ชาดำ", "beverage", ["tea leaves"]),
)
DAILY_SELLERS = (
    ("sweeting", "Sweetingred Co.", "Bangkok", Decimal("4.8")),
    ("bakemate", "BakeMate", "Bangkok", Decimal("4.6")),
    ("dairypro", "DairyPro", "Pathum Thani", Decimal("4.7")),
    ("thaidairy", "ThaiDairy", "Nakhon Pathom", Decimal("4.7")),
)
DAILY_LISTINGS = (
    ("pistachio-sweeting", "sweeting", "pistachio-paste", "820.00", 25),
    ("pistachio-bakemate", "bakemate", "pistachio-paste", "870.00", 20),
    ("cream-dairypro", "dairypro", "whipping-cream", "195.00", 30),
    ("milk-thaidairy", "thaidairy", "milk", "42.00", 50),
    ("strawberry-sweeting", "sweeting", "strawberry", "156.00", 35),
    ("mango-sweeting", "sweeting", "mango", "78.00", 35),
    ("flour-bakemate", "bakemate", "flour", "60.00", 40),
    *(
        (f"{ingredient_id}-bakemate", "bakemate", ingredient_id, "95.00", 24)
        for ingredient_id, *_ in DAILY_INGREDIENTS[6:]
    ),
)
CHECKOUT_LINES = (
    ("pistachio-sweeting", 5),
    ("cream-dairypro", 5),
    ("milk-thaidairy", 10),
)
CHECKOUT_TOTAL_THB = Decimal("5495.00")


class SeedTrend(TypedDict):
    slug: str
    name_en: str
    name_th: str
    kind: str
    momentum: str
    is_new: bool
    image_key: str
    why_rising_en: str
    why_rising_th: str
    score: Decimal
    sources: list[dict[str, str]]


def _seed_trend(
    slug: str,
    name_en: str,
    name_th: str,
    kind: str,
    rising_en: str,
    rising_th: str,
    score: str,
) -> SeedTrend:
    return {
        "slug": slug,
        "name_en": name_en,
        "name_th": name_th,
        "kind": kind,
        "momentum": "rising",
        "is_new": True,
        "image_key": slug,
        "why_rising_en": rising_en,
        "why_rising_th": rising_th,
        "score": Decimal(score),
        "sources": [
            {
                "url": f"https://example.com/{slug}",
                "title": f"{name_en} demo evidence",
                "published_at": "2026-11-19",
            }
        ],
    }


SEED_TRENDS = {
    "pistachio-gelato": _seed_trend(
        "pistachio-gelato",
        "Pistachio Gelato",
        "เจลาโตพิสตาชิโอ",
        "dessert",
        "Pistachio gelato is appearing in the demo dessert round-up.",
        "เจลาโตพิสตาชิโอปรากฏในรายการขนมหวานตัวอย่าง",
        "0.64",
    ),
    "strawberry-shortcake": _seed_trend(
        "strawberry-shortcake",
        "Strawberry Shortcake",
        "ชอร์ตเค้กสตรอว์เบอร์รี",
        "dessert",
        "Seasonal berry cakes appear in the demo bakery round-up.",
        "เค้กเบอร์รีตามฤดูกาลอยู่ในรายการเบเกอรีตัวอย่าง",
        "0.52",
    ),
    "mango-smoothie": _seed_trend(
        "mango-smoothie",
        "Mango Smoothie",
        "มะม่วงปั่น",
        "drink",
        "Fruit blends appear in the demo beverage round-up.",
        "เครื่องดื่มผลไม้ปั่นอยู่ในรายการเครื่องดื่มตัวอย่าง",
        "0.59",
    ),
}
SEED_TREND_INGREDIENTS = {
    "pistachio-gelato": (
        ("pistachio-paste", "Pistachio Paste", "เพสต์พิสตาชิโอ"),
        ("whipping-cream", "Whipping Cream", "วิปปิ้งครีม"),
        ("milk", "Milk", "นมสด"),
        (None, "kataifi topping", "ท็อปปิงคาตาอิฟี"),
    ),
    "strawberry-shortcake": (
        ("strawberry", "Strawberry", "สตรอว์เบอร์รี"),
        ("whipping-cream", "Whipping Cream", "วิปปิ้งครีม"),
        ("flour", "Cake Flour", "แป้งเค้ก"),
    ),
    "mango-smoothie": (
        ("mango", "Mango", "มะม่วง"),
        ("milk", "Milk", "นมสด"),
    ),
}
# Fit, rationale and menu idea in both locales, then priority ingredient IDs.
SeedInsight = tuple[str, str, str, str, str, tuple[str, ...]]
SEED_CATEGORY_INSIGHTS: dict[str, dict[str, SeedInsight]] = {
    "bakery": {
        "pistachio-gelato": (
            "1",
            "Works as a chilled bakery dessert.",
            "เหมาะกับขนมหวานเย็นในร้านเบเกอรี",
            "Pistachio Gelato Cake",
            "เค้กเจลาโตพิสตาชิโอ",
            ("pistachio-paste", "whipping-cream", "milk"),
        ),
        "strawberry-shortcake": (
            "0.8",
            "Fits the bakery cake counter.",
            "เหมาะกับตู้เค้กของร้านเบเกอรี",
            "Strawberry Layer Cake",
            "เค้กสตรอว์เบอร์รี",
            ("strawberry", "whipping-cream", "flour"),
        ),
        "mango-smoothie": (
            "0.5",
            "Offer as a drink alongside pastries.",
            "เสิร์ฟเป็นเครื่องดื่มคู่กับขนมอบ",
            "Mango Smoothie",
            "มะม่วงปั่น",
            ("mango", "milk"),
        ),
    },
    "cafe": {
        "strawberry-shortcake": (
            "1",
            "Pairs with the café's afternoon coffee.",
            "เข้ากับกาแฟยามบ่าย",
            "Strawberry Shortcake",
            "ชอร์ตเค้กสตรอว์เบอร์รี",
            ("strawberry", "whipping-cream"),
        ),
        "pistachio-gelato": (
            "0.75",
            "A small scoop works as a café dessert.",
            "เหมาะกับของหวานขนาดเล็ก",
            "Pistachio Gelato Cup",
            "เจลาโตพิสตาชิโอแบบถ้วย",
            ("pistachio-paste", "whipping-cream", "milk"),
        ),
        "mango-smoothie": (
            "0.65",
            "A caffeine-free menu option.",
            "เป็นเครื่องดื่มทางเลือกที่ไม่มีคาเฟอีน",
            "Mango Milk Smoothie",
            "สมูทตีมะม่วงนมสด",
            ("mango", "milk"),
        ),
    },
    "juice_shop": {
        "mango-smoothie": (
            "1",
            "Uses the shop's blender and fruit stock.",
            "ใช้เครื่องปั่นและผลไม้ที่ร้านมี",
            "Fresh Mango Smoothie",
            "สมูทตีมะม่วงสด",
            ("mango", "milk"),
        ),
        "strawberry-shortcake": (
            "0.6",
            "Use the fruit and cream in a dessert drink.",
            "ใช้ผลไม้และครีมทำเครื่องดื่มของหวาน",
            "Strawberry Cream Shake",
            "สตรอว์เบอร์รีครีมเชก",
            ("strawberry", "whipping-cream"),
        ),
    },
}


DAILY_USAGE_BY_CATEGORY = {
    "bakery": {
        "pistachio-paste": 2,
        "whipping-cream": 5,
        "milk": 10,
        "strawberry": 3,
        "flour": 8,
    },
    "cafe": {
        "pistachio-paste": 1,
        "whipping-cream": 2,
        "milk": 8,
        "strawberry": 5,
        "coffee": 5,
    },
    "juice_shop": {"mango": 9, "milk": 5, "strawberry": 4, "orange": 8},
}


def seed_daily_marketplace(connection: Connection, planning_date: date) -> None:
    """Insert restaurant fixtures and create the first saved publication for the given day."""
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO idea_a_shops (id, name, category, menu_tags, is_default)
            VALUES (%s, %s, %s, '[]', %s)
            ON CONFLICT DO NOTHING
            """,
            [
                (shop_id, name, category, shop_id == DEFAULT_DAILY_SHOP_ID)
                for shop_id, name, category in DAILY_SHOPS
            ],
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_fruits (id, name_en, name_th, tags, category, aliases, image_key)
            VALUES (%s, %s, %s, '[]', %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name_th = CASE
                    WHEN idea_a_fruits.name_th = idea_a_fruits.name_en THEN EXCLUDED.name_th
                    ELSE idea_a_fruits.name_th
                END,
                category = EXCLUDED.category, aliases = EXCLUDED.aliases, image_key = EXCLUDED.image_key
            WHERE idea_a_fruits.aliases = '[]' AND idea_a_fruits.image_key IS NULL
            """,
            [
                (ingredient_id, en, th, category, Jsonb(aliases), ingredient_id)
                for ingredient_id, en, th, category, aliases in DAILY_INGREDIENTS
            ],
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_sellers (id, name, area, rating)
            VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
            """,
            DAILY_SELLERS,
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_listings (id, seller_id, fruit_id, price_per_kg_thb, stock_kg, active)
            VALUES (%s, %s, %s, %s, %s, TRUE) ON CONFLICT DO NOTHING
            """,
            DAILY_LISTINGS,
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_usage (shop_id, fruit_id, usage_date, quantity_kg)
            VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING
            """,
            [
                (shop_id, ingredient_id, planning_date - timedelta(days=offset), qty)
                for shop_id, _, category in DAILY_SHOPS
                for ingredient_id, qty in DAILY_USAGE_BY_CATEGORY[category].items()
                for offset in range(1, 8)
            ],
        )
        _seed_daily_publication(cursor, planning_date)


def _seed_daily_publication(cursor: Cursor, planning_date: date) -> None:
    run_id = f"seed-{planning_date.isoformat()}"
    timestamp = datetime.combine(planning_date, time(6), BANGKOK)
    inserted = cursor.execute(
        """
        INSERT INTO idea_a_daily_runs (id, trend_date, started_at, finished_at, status, source)
        VALUES (%s, %s, %s, %s, 'fallback', 'seed')
        ON CONFLICT (trend_date) DO NOTHING RETURNING id
        """,
        (run_id, planning_date, timestamp, timestamp),
    ).fetchone()
    if inserted is None:
        return

    cursor.executemany(
        """
        INSERT INTO idea_a_daily_trends
            (run_id, slug, name_en, name_th, kind, momentum, is_new, why_rising_en,
             why_rising_th, image_key, sources, score)
        VALUES (%(run_id)s, %(slug)s, %(name_en)s, %(name_th)s, %(kind)s, %(momentum)s,
            %(is_new)s, %(why_rising_en)s, %(why_rising_th)s, %(image_key)s, %(sources)s, %(score)s)
        """,
        [
            {**trend, "sources": Jsonb(trend["sources"]), "run_id": run_id}
            for trend in SEED_TRENDS.values()
        ],
    )
    cursor.executemany(
        """
        INSERT INTO idea_a_daily_trend_ingredients
            (run_id, trend_slug, position, ingredient_id, name_en, name_th)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        [
            (run_id, slug, position, ingredient_id, en, th)
            for slug, ingredients in SEED_TREND_INGREDIENTS.items()
            for position, (ingredient_id, en, th) in enumerate(ingredients)
        ],
    )
    cursor.executemany(
        """
        INSERT INTO idea_a_daily_category_insights
            (run_id, trend_slug, category, fit, why_fit_en, why_fit_th,
             menu_idea_en, menu_idea_th, priority_ingredient_ids)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        [
            (
                run_id,
                slug,
                category,
                fit,
                fit_en,
                fit_th,
                menu_en,
                menu_th,
                Jsonb(list(ids)),
            )
            for category, insights in SEED_CATEGORY_INSIGHTS.items()
            for slug, (fit, fit_en, fit_th, menu_en, menu_th, ids) in insights.items()
        ],
    )
    for shop_id, _, category in DAILY_SHOPS:
        insights = SEED_CATEGORY_INSIGHTS[category]
        ranked = sorted(
            insights,
            key=lambda slug: (
                -Decimal(insights[slug][0]) * SEED_TRENDS[slug]["score"],
                slug,
            ),
        )
        cursor.executemany(
            """
            INSERT INTO idea_a_daily_recommendations (run_id, shop_id, trend_slug, position, ingredients)
            VALUES (%s, %s, %s, %s, %s)
            """,
            [
                (
                    run_id,
                    shop_id,
                    slug,
                    position,
                    Jsonb(_seed_recommendations(cursor, category, slug)),
                )
                for position, slug in enumerate(ranked)
            ],
        )


def _seed_recommendations(
    cursor: Cursor, category: str, slug: str
) -> list[dict[str, object]]:
    priorities = SEED_CATEGORY_INSIGHTS[category][slug][-1]
    items = []
    for ingredient_id in priorities:
        offers = cursor.execute(
            """
            SELECT listing.id, seller.id, seller.name, listing.price_per_kg_thb, listing.stock_kg
            FROM idea_a_listings listing JOIN idea_a_sellers seller ON seller.id = listing.seller_id
            WHERE listing.fruit_id = %s AND listing.active AND listing.stock_kg > 0
            ORDER BY listing.price_per_kg_thb, listing.id LIMIT 2
            """,
            (ingredient_id,),
        ).fetchall()
        qty = DAILY_USAGE_BY_CATEGORY[category].get(ingredient_id, 2)
        listings = [
            {
                "id": id_,
                "seller_id": seller_id,
                "seller_name": name,
                "price_per_kg_thb": f"{price:.2f}",
                "stock_kg": stock,
            }
            for id_, seller_id, name, price, stock in offers
        ]
        items.append(
            {
                "ingredient_id": ingredient_id,
                "suggested_kg": qty,
                "listings": listings,
                "score": str(SEED_TRENDS[slug]["score"]),
                "explanation": f"Suggested {qty} kg for {SEED_TRENDS[slug]['name_en']}.",
            }
        )
    return items
