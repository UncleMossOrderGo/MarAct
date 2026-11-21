"""Add shop inventory and persisted assistant conversations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "idea_a_0005"
down_revision = "idea_a_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idea_a_shop_stock",
        sa.Column(
            "shop_id", sa.Text, sa.ForeignKey("idea_a_shops.id"), primary_key=True
        ),
        sa.Column(
            "ingredient_id",
            sa.Text,
            sa.ForeignKey("idea_a_fruits.id"),
            primary_key=True,
        ),
        sa.Column("kg_on_hand", sa.Numeric(12, 3), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kg_on_hand BETWEEN 0 AND 1000000"),
    )
    op.create_table(
        "idea_a_agent_threads",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("shop_id", sa.Text, sa.ForeignKey("idea_a_shops.id"), nullable=False),
        sa.Column("title", sa.String(60), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "idea_a_agent_threads_shop_idx",
        "idea_a_agent_threads",
        ["shop_id", "updated_at"],
    )
    op.create_table(
        "idea_a_agent_messages",
        sa.Column(
            "thread_id",
            sa.Text,
            sa.ForeignKey("idea_a_agent_threads.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("request_id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("page_context", JSONB, nullable=False),
        sa.Column("answer", sa.Text),
        sa.Column("actions", JSONB, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("idea_a_agent_messages")
    op.drop_table("idea_a_agent_threads")
    op.drop_table("idea_a_shop_stock")
