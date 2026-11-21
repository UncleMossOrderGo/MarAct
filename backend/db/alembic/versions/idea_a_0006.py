"""Supplier delivery terms and in-app trial quote requests."""

from alembic import op

revision = "idea_a_0006"
down_revision = "idea_a_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE idea_a_trial_terms (
            listing_id text PRIMARY KEY REFERENCES idea_a_listings(id),
            min_kg integer NOT NULL CHECK (min_kg BETWEEN 1 AND 500),
            shipping_thb numeric(10,2) NOT NULL CHECK (shipping_thb >= 0),
            lead_days integer NOT NULL CHECK (lead_days BETWEEN 0 AND 30),
            confirmed_at timestamptz NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE idea_a_trial_quotes (
            id uuid PRIMARY KEY,
            shop_id text NOT NULL REFERENCES idea_a_shops(id),
            seller_id text NOT NULL REFERENCES idea_a_sellers(id),
            listing_id text NOT NULL REFERENCES idea_a_listings(id),
            trend_slug text NOT NULL,
            qty_kg integer NOT NULL CHECK (qty_kg BETWEEN 1 AND 500),
            budget_thb numeric(12,2) NOT NULL,
            needed_by date NOT NULL,
            delivered_thb numeric(14,2) NOT NULL,
            arrival date NOT NULL,
            match_ms integer NOT NULL CHECK (match_ms >= 0),
            created_at timestamptz NOT NULL
        )
    """)
    op.execute(
        "CREATE INDEX idea_a_trial_quotes_supplier ON idea_a_trial_quotes (seller_id, created_at DESC)"
    )


def downgrade() -> None:
    op.drop_table("idea_a_trial_quotes")
    op.drop_table("idea_a_trial_terms")
