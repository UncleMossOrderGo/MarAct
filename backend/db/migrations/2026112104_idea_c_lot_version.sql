ALTER TABLE idea_c_lots ADD COLUMN version bigint NOT NULL DEFAULT 1;

CREATE FUNCTION idea_c_bump_lot_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER idea_c_lot_version BEFORE UPDATE ON idea_c_lots
FOR EACH ROW EXECUTE FUNCTION idea_c_bump_lot_version();
