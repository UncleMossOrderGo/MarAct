"""Record observed trial matches independently of quote requests."""

from alembic import op

revision = "idea_a_0007"
down_revision = "idea_a_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE idea_a_trial_matches (
            id uuid PRIMARY KEY,
            shop_id text NOT NULL REFERENCES idea_a_shops(id),
            trend_slug text NOT NULL,
            match_ms integer NOT NULL CHECK (match_ms >= 0),
            created_at timestamptz NOT NULL
        )
    """)


def downgrade() -> None:
    op.drop_table("idea_a_trial_matches")
