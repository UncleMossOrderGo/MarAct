INSERT INTO idea_a_records (title, seed_key)
VALUES ('Sample record for Idea A', 'sample-v1')
ON CONFLICT (seed_key) DO NOTHING;
