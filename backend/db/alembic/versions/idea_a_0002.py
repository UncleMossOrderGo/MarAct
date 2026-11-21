"""Introduce the Idea A marketplace and retain v1 restocking data."""

from alembic import op

revision = "idea_a_0002"
down_revision = "idea_a_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("idea_a_fruits", "idea_a_legacy_fruits")
    op.execute(
        "ALTER TABLE idea_a_legacy_fruits RENAME CONSTRAINT idea_a_fruits_pkey TO idea_a_legacy_fruits_pkey"
    )
    op.rename_table("idea_a_usage", "idea_a_legacy_usage")
    op.execute(
        "ALTER TABLE idea_a_legacy_usage RENAME CONSTRAINT idea_a_usage_pkey TO idea_a_legacy_usage_pkey"
    )
    op.execute(
        """
        CREATE TABLE idea_a_fruits (
            id TEXT NOT NULL,
            name_en TEXT NOT NULL,
            name_th TEXT NOT NULL,
            tags JSONB NOT NULL,
            PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE idea_a_sellers (
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            area TEXT NOT NULL,
            rating NUMERIC(2, 1) NOT NULL,
            PRIMARY KEY (id),
            CHECK (rating BETWEEN 0 AND 5)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE idea_a_shops (
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            menu_tags JSONB NOT NULL,
            PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE idea_a_trend_runs (
            id TEXT NOT NULL,
            started_at TIMESTAMP WITH TIME ZONE NOT NULL,
            finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
            status TEXT NOT NULL,
            source TEXT NOT NULL,
            PRIMARY KEY (id),
            CHECK (status IN ('ok', 'fallback', 'error')),
            CHECK (source IN ('live', 'seed')),
            CHECK (finished_at >= started_at)
        )
        """
    )
    op.execute(
        "CREATE INDEX idea_a_trend_runs_finished_idx ON idea_a_trend_runs (finished_at)"
    )
    op.execute(
        """
        CREATE TABLE idea_a_listings (
            id TEXT NOT NULL,
            seller_id TEXT NOT NULL,
            fruit_id TEXT NOT NULL,
            price_per_kg_thb NUMERIC(14, 2) NOT NULL,
            stock_kg INTEGER NOT NULL,
            active BOOLEAN NOT NULL,
            PRIMARY KEY (id),
            UNIQUE (seller_id, fruit_id),
            CHECK (price_per_kg_thb >= 0 AND price_per_kg_thb < 'Infinity'),
            CHECK (stock_kg >= 0),
            FOREIGN KEY (seller_id) REFERENCES idea_a_sellers (id),
            FOREIGN KEY (fruit_id) REFERENCES idea_a_fruits (id)
        )
        """
    )
    op.execute("CREATE INDEX idea_a_listings_fruit_idx ON idea_a_listings (fruit_id)")
    op.execute(
        """
        CREATE TABLE idea_a_orders (
            id TEXT NOT NULL,
            shop_id TEXT NOT NULL,
            idempotency_key UUID NOT NULL,
            status TEXT NOT NULL,
            total_thb NUMERIC(24, 2) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            PRIMARY KEY (id),
            CHECK (total_thb >= 0 AND total_thb < 'Infinity'),
            FOREIGN KEY (shop_id) REFERENCES idea_a_shops (id),
            UNIQUE (idempotency_key)
        )
        """
    )
    op.execute(
        "CREATE INDEX idea_a_orders_shop_created_idx ON idea_a_orders (shop_id, created_at)"
    )
    op.execute(
        """
        CREATE TABLE idea_a_recommendations (
            feed_key TEXT NOT NULL,
            locale TEXT NOT NULL,
            fruit_id TEXT NOT NULL,
            explanation TEXT NOT NULL,
            PRIMARY KEY (feed_key, locale, fruit_id),
            FOREIGN KEY (fruit_id) REFERENCES idea_a_fruits (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE idea_a_trends (
            run_id TEXT NOT NULL,
            fruit_id TEXT NOT NULL,
            trend_name TEXT NOT NULL,
            rationale TEXT NOT NULL,
            related_menus JSONB NOT NULL,
            confidence NUMERIC NOT NULL,
            mention_count INTEGER NOT NULL,
            score NUMERIC NOT NULL,
            sources JSONB NOT NULL,
            PRIMARY KEY (run_id, fruit_id),
            CHECK (confidence BETWEEN 0 AND 1),
            CHECK (mention_count >= 0),
            CHECK (score BETWEEN 0 AND 1),
            FOREIGN KEY (run_id) REFERENCES idea_a_trend_runs (id),
            FOREIGN KEY (fruit_id) REFERENCES idea_a_fruits (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE idea_a_usage (
            shop_id TEXT NOT NULL,
            fruit_id TEXT NOT NULL,
            usage_date DATE NOT NULL,
            quantity_kg NUMERIC NOT NULL,
            PRIMARY KEY (shop_id, fruit_id, usage_date),
            CHECK (quantity_kg >= 0 AND quantity_kg < 'Infinity'),
            FOREIGN KEY (shop_id) REFERENCES idea_a_shops (id),
            FOREIGN KEY (fruit_id) REFERENCES idea_a_fruits (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE idea_a_order_items (
            order_id TEXT NOT NULL,
            listing_id TEXT NOT NULL,
            fruit_id TEXT NOT NULL,
            fruit_name TEXT NOT NULL,
            seller_name TEXT NOT NULL,
            qty_kg INTEGER NOT NULL,
            price_per_kg_thb NUMERIC(14, 2) NOT NULL,
            line_total_thb NUMERIC(24, 2) NOT NULL,
            PRIMARY KEY (order_id, listing_id),
            CHECK (qty_kg BETWEEN 1 AND 500),
            CHECK (price_per_kg_thb >= 0 AND price_per_kg_thb < 'Infinity'),
            CHECK (line_total_thb = price_per_kg_thb * qty_kg),
            FOREIGN KEY (order_id) REFERENCES idea_a_orders (id),
            FOREIGN KEY (listing_id) REFERENCES idea_a_listings (id),
            FOREIGN KEY (fruit_id) REFERENCES idea_a_fruits (id)
        )
        """
    )

    # Preserve original café IDs so migrated usage stays associated with the same owner.
    op.execute(
        """
        INSERT INTO idea_a_shops (id, name, category, menu_tags)
        SELECT id,
            CASE WHEN id = 'demo' THEN 'Smoothie Café' ELSE name END,
            CASE WHEN id = 'demo' THEN 'smoothie' ELSE 'cafe' END,
            CASE WHEN id = 'demo' THEN '["smoothie", "tropical"]'::jsonb ELSE '[]'::jsonb END
        FROM idea_a_cafes
        """
    )
    op.execute(
        """
        INSERT INTO idea_a_fruits (id, name_en, name_th, tags)
        SELECT DISTINCT ON (fruit_id) fruit_id, name, name, '[]'::jsonb
        FROM idea_a_legacy_fruits
        ORDER BY fruit_id, cafe_id
        """
    )
    op.execute(
        """
        INSERT INTO idea_a_usage (shop_id, fruit_id, usage_date, quantity_kg)
        SELECT cafe_id, fruit_id, usage_date, quantity_kg
        FROM idea_a_legacy_usage
        WHERE quantity_kg >= 0 AND quantity_kg < 'Infinity'
        """
    )


def downgrade() -> None:
    op.drop_table("idea_a_order_items")
    op.drop_table("idea_a_usage")
    op.drop_table("idea_a_trends")
    op.drop_table("idea_a_recommendations")
    op.drop_table("idea_a_orders")
    op.drop_table("idea_a_listings")
    op.drop_table("idea_a_trend_runs")
    op.drop_table("idea_a_shops")
    op.drop_table("idea_a_sellers")
    op.drop_table("idea_a_fruits")
    op.execute(
        "ALTER TABLE idea_a_legacy_usage RENAME CONSTRAINT idea_a_legacy_usage_pkey TO idea_a_usage_pkey"
    )
    op.rename_table("idea_a_legacy_usage", "idea_a_usage")
    op.execute(
        "ALTER TABLE idea_a_legacy_fruits RENAME CONSTRAINT idea_a_legacy_fruits_pkey TO idea_a_fruits_pkey"
    )
    op.rename_table("idea_a_legacy_fruits", "idea_a_fruits")
