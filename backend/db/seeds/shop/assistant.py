"""Initial on-hand stock for the default demo bakery."""

from psycopg import Connection


def seed_assistant_stock(connection: Connection) -> None:
    inventories = (
        ("pistachio-paste", "3.000"),
        ("whipping-cream", "4.000"),
        ("milk", "12.000"),
        ("flour", "28.000"),
        ("sugar", "10.000"),
    )
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO idea_a_shop_stock (shop_id, ingredient_id, kg_on_hand, updated_at)
            SELECT shop.id, ingredient.id, %s, CURRENT_TIMESTAMP
            FROM idea_a_shops shop CROSS JOIN idea_a_fruits ingredient
            WHERE shop.id = 'bakery-main' AND ingredient.id = %s
            ON CONFLICT (shop_id, ingredient_id) DO NOTHING
            """,
            [(quantity, ingredient) for ingredient, quantity in inventories],
        )
