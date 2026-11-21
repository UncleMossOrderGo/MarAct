from backend.src.testing.records import check_records


def test_records() -> None:
    check_records("idea-b", "DELETE FROM idea_b_records WHERE title = %s")
