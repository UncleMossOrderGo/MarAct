CREATE TABLE market_copilot_quota (
    bucket text NOT NULL,
    starts_at timestamptz NOT NULL,
    turns integer NOT NULL CHECK (turns > 0),
    PRIMARY KEY (bucket, starts_at)
);
