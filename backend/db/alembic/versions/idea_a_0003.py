"""Extend the marketplace with a multilingual catalog and dated publications."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "idea_a_0003"
down_revision = "idea_a_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "idea_a_shops",
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "idea_a_shops_default_idx",
        "idea_a_shops",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )
    op.add_column(
        "idea_a_fruits",
        sa.Column("aliases", JSONB, nullable=False, server_default="[]"),
    )
    op.add_column(
        "idea_a_fruits",
        sa.Column("category", sa.Text, nullable=False, server_default="fruit"),
    )
    op.add_column(
        "idea_a_fruits", sa.Column("unit", sa.Text, nullable=False, server_default="kg")
    )
    op.add_column("idea_a_fruits", sa.Column("image_key", sa.Text))
    op.add_column("idea_a_order_items", sa.Column("trend_slug", sa.Text))
    op.add_column("idea_a_order_items", sa.Column("trend_label", sa.Text))
    op.add_column("idea_a_order_items", sa.Column("line_index", sa.Integer))
    op.execute("""
        UPDATE idea_a_order_items AS item
        SET line_index = numbered.line_index
        FROM (
            SELECT order_id, listing_id,
                row_number() OVER (PARTITION BY order_id ORDER BY listing_id) - 1 AS line_index
            FROM idea_a_order_items
        ) AS numbered
        WHERE item.order_id = numbered.order_id AND item.listing_id = numbered.listing_id
    """)
    op.execute("CREATE SEQUENCE idea_a_order_item_line_index AS integer")
    op.execute("""
        SELECT setval('idea_a_order_item_line_index', GREATEST(COALESCE(MAX(line_index), 0), 1))
        FROM idea_a_order_items
    """)
    op.alter_column(
        "idea_a_order_items",
        "line_index",
        nullable=False,
        server_default=sa.text("nextval('idea_a_order_item_line_index')"),
    )
    op.drop_constraint("idea_a_order_items_pkey", "idea_a_order_items", type_="primary")
    op.create_primary_key(
        "idea_a_order_items_pkey", "idea_a_order_items", ["order_id", "line_index"]
    )
    op.create_table(
        "idea_a_daily_runs",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("trend_date", sa.Date, nullable=False, unique=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("source", sa.Text, nullable=False),
        sa.CheckConstraint("finished_at >= started_at"),
        sa.CheckConstraint("status IN ('ok', 'fallback')"),
        sa.CheckConstraint("source IN ('live', 'seed')"),
    )
    op.create_table(
        "idea_a_daily_trends",
        sa.Column(
            "run_id",
            sa.Text,
            sa.ForeignKey("idea_a_daily_runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("slug", sa.Text, primary_key=True),
        sa.Column("name_en", sa.Text, nullable=False),
        sa.Column("name_th", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("momentum", sa.Text, nullable=False),
        sa.Column("is_new", sa.Boolean, nullable=False),
        sa.Column("why_rising_en", sa.Text, nullable=False),
        sa.Column("why_rising_th", sa.Text, nullable=False),
        sa.Column("image_key", sa.Text),
        sa.Column("sources", JSONB, nullable=False),
        sa.Column("score", sa.Numeric, nullable=False),
        sa.CheckConstraint("score BETWEEN 0 AND 1"),
    )
    op.create_table(
        "idea_a_daily_trend_ingredients",
        sa.Column("run_id", sa.Text, primary_key=True),
        sa.Column("trend_slug", sa.Text, primary_key=True),
        sa.Column("position", sa.Integer, primary_key=True),
        sa.Column("name_en", sa.Text, nullable=False),
        sa.Column("name_th", sa.Text, nullable=False),
        sa.Column("ingredient_id", sa.Text, sa.ForeignKey("idea_a_fruits.id")),
        _trend_fk(),
    )
    op.create_table(
        "idea_a_daily_category_insights",
        sa.Column("run_id", sa.Text, primary_key=True),
        sa.Column("trend_slug", sa.Text, primary_key=True),
        sa.Column("category", sa.Text, primary_key=True),
        sa.Column("fit", sa.Numeric, nullable=False),
        sa.Column("why_fit_en", sa.Text, nullable=False),
        sa.Column("why_fit_th", sa.Text, nullable=False),
        sa.Column("menu_idea_en", sa.Text, nullable=False),
        sa.Column("menu_idea_th", sa.Text, nullable=False),
        sa.Column("priority_ingredient_ids", JSONB, nullable=False),
        _trend_fk(),
        sa.CheckConstraint("fit BETWEEN 0.4 AND 1"),
    )
    op.create_table(
        "idea_a_daily_recommendations",
        sa.Column("run_id", sa.Text, primary_key=True),
        sa.Column(
            "shop_id", sa.Text, sa.ForeignKey("idea_a_shops.id"), primary_key=True
        ),
        sa.Column("trend_slug", sa.Text, primary_key=True),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("ingredients", JSONB, nullable=False),
        _trend_fk(),
        sa.UniqueConstraint("run_id", "shop_id", "position"),
    )
    op.create_table(
        "idea_a_daily_job_attempts",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "sequence", sa.BigInteger, sa.Identity(), nullable=False, unique=True
        ),
        sa.Column("trend_date", sa.Date, nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("state", sa.Text, nullable=False),
        sa.Column("publication_id", sa.Text),
        sa.Column("error", sa.Text),
        sa.CheckConstraint("state IN ('running', 'published', 'error')"),
    )
    op.create_index(
        "idea_a_daily_attempts_started_idx", "idea_a_daily_job_attempts", ["started_at"]
    )


def _trend_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["run_id", "trend_slug"],
        ["idea_a_daily_trends.run_id", "idea_a_daily_trends.slug"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    # The old key cannot represent multiple attribution lines for one listing.
    op.drop_constraint("idea_a_order_items_pkey", "idea_a_order_items", type_="primary")
    op.create_primary_key(
        "idea_a_order_items_pkey", "idea_a_order_items", ["order_id", "listing_id"]
    )
    op.drop_column("idea_a_order_items", "line_index")
    op.execute("DROP SEQUENCE idea_a_order_item_line_index")
    op.drop_column("idea_a_order_items", "trend_label")
    op.drop_column("idea_a_order_items", "trend_slug")
    op.drop_table("idea_a_daily_job_attempts")
    op.drop_table("idea_a_daily_recommendations")
    op.drop_table("idea_a_daily_category_insights")
    op.drop_table("idea_a_daily_trend_ingredients")
    op.drop_table("idea_a_daily_trends")
    op.drop_table("idea_a_daily_runs")
    for column in ("image_key", "unit", "category", "aliases"):
        op.drop_column("idea_a_fruits", column)
    op.drop_index("idea_a_shops_default_idx", table_name="idea_a_shops")
    op.drop_column("idea_a_shops", "is_default")
