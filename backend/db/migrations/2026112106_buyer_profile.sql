ALTER TABLE idea_c_buyers
  ADD COLUMN business text NOT NULL DEFAULT '',
  ADD COLUMN postcode text NOT NULL DEFAULT '' CHECK (postcode = '' OR postcode ~ '^[0-9]{5}$');
