INSERT INTO idea_b_records (title, seed_key)
VALUES ('Sample record for Idea B', 'sample-v1')
ON CONFLICT (seed_key) DO NOTHING;
