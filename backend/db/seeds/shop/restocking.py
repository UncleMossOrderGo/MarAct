from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg import Connection

BANGKOK = ZoneInfo("Asia/Bangkok")
DEMO_CAFE_ID = "demo"
DEMO_SNAPSHOT_ID = "demo-initial"
# Fruit ID, name, daily usage, on-hand stock, stock to use today.
DEMO_FRUITS = (
    ("mango", "Mango", Decimal(8), Decimal(8), Decimal(3)),
    ("pineapple", "Pineapple", Decimal(4), Decimal(14), Decimal(8)),
    ("banana", "Banana", Decimal(4), Decimal(8), Decimal(0)),
)


def seed_demo(connection: Connection, planning_date: date) -> None:
    """Load the demo within the caller's transaction."""
    connection.execute(
        "INSERT INTO idea_a_cafes (id, name) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        (DEMO_CAFE_ID, "Demo Café"),
    )
    connection.execute(
        "SELECT id FROM idea_a_cafes WHERE id = %s FOR UPDATE", (DEMO_CAFE_ID,)
    )
    for position, (fruit_id, name, usage, _, _) in enumerate(DEMO_FRUITS):
        connection.execute(
            """
            INSERT INTO idea_a_fruits (cafe_id, fruit_id, name, position)
            VALUES (%s, %s, %s, %s) ON CONFLICT (cafe_id, fruit_id) DO NOTHING
            """,
            (DEMO_CAFE_ID, fruit_id, name, position),
        )
        for days_ago in range(7, 0, -1):
            usage_date = planning_date - timedelta(days=days_ago)
            daily_usage = usage + Decimal(usage_date.weekday() - 3) / 2
            connection.execute(
                """
                INSERT INTO idea_a_usage (cafe_id, fruit_id, usage_date, quantity_kg)
                VALUES (%s, %s, %s, %s) ON CONFLICT (cafe_id, fruit_id, usage_date) DO NOTHING
                """,
                (
                    DEMO_CAFE_ID,
                    fruit_id,
                    usage_date,
                    daily_usage,
                ),
            )

    snapshot = connection.execute(
        """
        INSERT INTO idea_a_stock_snapshots (id, cafe_id, updated_at)
        SELECT %s, %s, %s WHERE NOT EXISTS (
            SELECT 1 FROM idea_a_stock_snapshots WHERE cafe_id = %s
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        """,
        (
            DEMO_SNAPSHOT_ID,
            DEMO_CAFE_ID,
            datetime.combine(planning_date, time.min, BANGKOK),
            DEMO_CAFE_ID,
        ),
    ).fetchone()
    if snapshot is None:
        return

    for fruit_id, _, _, stock, use_today in DEMO_FRUITS:
        connection.execute(
            """
            INSERT INTO idea_a_stock_items (snapshot_id, fruit_id, stock_kg, use_today_kg)
            VALUES (%s, %s, %s, %s)
            """,
            (DEMO_SNAPSHOT_ID, fruit_id, stock, use_today),
        )
