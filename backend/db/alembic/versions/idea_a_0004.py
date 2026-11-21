"""Track marketplace checkout groups, seller fulfillment and inbox events."""

import sqlalchemy as sa
from alembic import op

revision = "idea_a_0004"
down_revision = "idea_a_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idea_a_checkout_groups",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("shop_id", sa.Text, sa.ForeignKey("idea_a_shops.id"), nullable=False),
        sa.Column("idempotency_key", sa.Uuid, unique=True, nullable=False),
    )
    op.create_table(
        "idea_a_order_fulfillment",
        sa.Column(
            "order_id", sa.Text, sa.ForeignKey("idea_a_orders.id"), primary_key=True
        ),
        sa.Column(
            "checkout_group_id",
            sa.Text,
            sa.ForeignKey("idea_a_checkout_groups.id"),
            nullable=False,
        ),
        sa.Column(
            "seller_id", sa.Text, sa.ForeignKey("idea_a_sellers.id"), nullable=False
        ),
        sa.Column("seller_name", sa.Text, nullable=False),
        sa.Column("payment_ref", sa.Text, unique=True),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("checkout_group_id", "seller_id"),
    )
    op.create_index(
        "idea_a_order_fulfillment_seller_idx", "idea_a_order_fulfillment", ["seller_id"]
    )
    op.create_table(
        "idea_a_notifications",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("recipient_type", sa.Text, nullable=False),
        sa.Column("recipient_id", sa.Text, nullable=False),
        sa.Column("event_key", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("link", sa.Text, nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("recipient_type IN ('shop', 'seller')"),
        sa.UniqueConstraint("recipient_type", "recipient_id", "event_key"),
    )
    op.create_index(
        "idea_a_notifications_recipient_idx",
        "idea_a_notifications",
        ["recipient_type", "recipient_id", "created_at"],
    )


def downgrade() -> None:
    # Orders and their status are retained; only the additional workflow metadata is removed.
    op.drop_table("idea_a_notifications")
    op.drop_table("idea_a_order_fulfillment")
    op.drop_table("idea_a_checkout_groups")
