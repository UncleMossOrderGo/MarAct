from backend.src.shared.records import records_router

router = records_router(
    "SELECT id, title FROM idea_a_records ORDER BY id",
    "INSERT INTO idea_a_records (title) VALUES (%s) RETURNING id, title",
)
