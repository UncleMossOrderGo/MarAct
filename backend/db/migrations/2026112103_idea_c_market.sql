CREATE TABLE idea_c_lots (
 id text PRIMARY KEY, farm text NOT NULL, name text NOT NULL, uses text NOT NULL,
 grade text, unit text NOT NULL, kg numeric CHECK (kg > 0), price integer NOT NULL CHECK(price > 0),
 minimum integer NOT NULL CHECK(minimum > 0), stock integer NOT NULL CHECK(stock >= 0),
 starts date NOT NULL, ends date NOT NULL CHECK(ends >= starts), transit integer NOT NULL CHECK(transit >= 0),
 postcodes text[] NOT NULL, freight integer NOT NULL CHECK(freight >= 0), trend integer NOT NULL DEFAULT 0
);
CREATE TABLE idea_c_buyers (
 name text PRIMARY KEY, salt bytea NOT NULL, digest bytea NOT NULL
);
CREATE TABLE idea_c_sessions (
 digest text PRIMARY KEY, buyer text NOT NULL REFERENCES idea_c_buyers, expires timestamptz NOT NULL
);
CREATE TABLE idea_c_orders (
 id uuid PRIMARY KEY, buyer text NOT NULL REFERENCES idea_c_buyers, farm text NOT NULL,
 address text NOT NULL, postcode text NOT NULL, arrival date NOT NULL,
 lines jsonb NOT NULL, freight integer NOT NULL, total bigint NOT NULL,
 state text NOT NULL DEFAULT 'pending', expires timestamptz NOT NULL DEFAULT now()+interval '12 hours',
 created timestamptz NOT NULL DEFAULT now(), payment text NOT NULL DEFAULT '',
 events jsonb NOT NULL DEFAULT '[]', issue text NOT NULL DEFAULT '', refund text NOT NULL DEFAULT ''
);
CREATE INDEX idea_c_pending ON idea_c_orders(expires) WHERE state='pending';
