"""Create the Idea A restocking tables."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "idea_a_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idea_a_cafes",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
    )
    op.create_table(
        "idea_a_fruits",
        sa.Column(
            "cafe_id", sa.Text, sa.ForeignKey("idea_a_cafes.id"), primary_key=True
        ),
        sa.Column("fruit_id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.UniqueConstraint("cafe_id", "position"),
    )
    op.create_table(
        "idea_a_usage",
        sa.Column("cafe_id", sa.Text, primary_key=True),
        sa.Column("fruit_id", sa.Text, primary_key=True),
        sa.Column("usage_date", sa.Date, primary_key=True),
        sa.Column("quantity_kg", sa.Numeric, nullable=False),
        sa.ForeignKeyConstraint(
            ("cafe_id", "fruit_id"), ("idea_a_fruits.cafe_id", "idea_a_fruits.fruit_id")
        ),
        sa.CheckConstraint("quantity_kg >= 0"),
    )
    op.create_table(
        "idea_a_stock_snapshots",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("cafe_id", sa.Text, sa.ForeignKey("idea_a_cafes.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "idea_a_stock_snapshots_cafe_updated_idx",
        "idea_a_stock_snapshots",
        ["cafe_id", "updated_at"],
    )
    op.create_table(
        "idea_a_stock_items",
        sa.Column(
            "snapshot_id",
            sa.Text,
            sa.ForeignKey("idea_a_stock_snapshots.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("fruit_id", sa.Text, primary_key=True),
        sa.Column("stock_kg", sa.Numeric, nullable=False),
        sa.Column("use_today_kg", sa.Numeric, nullable=False),
        sa.CheckConstraint("use_today_kg >= 0 AND use_today_kg <= stock_kg"),
    )
    op.create_table(
        "idea_a_plans",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("cafe_id", sa.Text, sa.ForeignKey("idea_a_cafes.id"), nullable=False),
        sa.Column("delivery_date", sa.Date, nullable=False),
        sa.Column("delivery_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cutoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "snapshot_id",
            sa.Text,
            sa.ForeignKey("idea_a_stock_snapshots.id"),
            nullable=False,
        ),
        sa.Column("items", JSONB, nullable=False),
        sa.UniqueConstraint("cafe_id", "delivery_date"),
    )
    op.create_table(
        "idea_a_drafts",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column(
            "plan_id",
            sa.Text,
            sa.ForeignKey("idea_a_plans.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("items", JSONB, nullable=False),
        sa.Column("message", sa.Text, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("idea_a_drafts")
    op.drop_table("idea_a_plans")
    op.drop_table("idea_a_stock_items")
    op.drop_index(
        "idea_a_stock_snapshots_cafe_updated_idx", table_name="idea_a_stock_snapshots"
    )
    op.drop_table("idea_a_stock_snapshots")
    op.drop_table("idea_a_usage")
    op.drop_table("idea_a_fruits")
    op.drop_table("idea_a_cafes")
