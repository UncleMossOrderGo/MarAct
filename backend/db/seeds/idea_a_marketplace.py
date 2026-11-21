from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg import Connection
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
