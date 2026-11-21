from backend.src.testing.records import check_records


def test_records() -> None:
    check_records("idea-a", "DELETE FROM idea_a_records WHERE title = %s")
