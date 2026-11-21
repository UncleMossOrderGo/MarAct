-- The LINE workspace owns farm terms. Buyer reservations own the sellable balance.
CREATE TABLE market_farm_listing_sync (
    lot_id text PRIMARY KEY REFERENCES idea_c_lots(id),
    terms_hash text NOT NULL
);
