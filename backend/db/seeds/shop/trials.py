"""Illustrative Bangkok delivery terms for the seeded suppliers."""

import psycopg


def seed_trial_terms(connection: psycopg.Connection) -> None:
    connection.execute("""
        INSERT INTO idea_a_trial_terms (listing_id, min_kg, shipping_thb, lead_days, confirmed_at)
        SELECT l.id, terms.minimum, terms.fee, terms.days, now()
        FROM idea_a_listings l JOIN (VALUES
          ('orchard',3,65,2), ('market',1,35,1), ('harvest',4,50,2),
          ('sweeting',1,40,1), ('bakemate',3,55,2), ('dairypro',2,45,1), ('thaidairy',1,50,2)
        ) AS terms(seller,minimum,fee,days) ON terms.seller=l.seller_id
        ON CONFLICT (listing_id) DO NOTHING
    """)
