from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from alembic.config import Config
from psycopg import sql
from psycopg.conninfo import make_conninfo

from backend.db import manage
from backend.src.shared.db import database_url


def test_migrations_share_lock_and_can_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    url = database_url()
    schema_name = f"test_migration_{uuid4().hex}"
    schema = sql.Identifier(schema_name)
    isolated_url = make_conninfo(url, options=f"-csearch_path={schema_name}")
    monkeypatch.setenv("DATABASE_URL", isolated_url)
    upgrade = manage.command.upgrade

    def fail_after_upgrade(config: Config, revision: str) -> None:
        connection = config.attributes["connection"]
        assert connection.exec_driver_sql("SELECT to_regclass('idea_b_records')").scalar()
        with psycopg.connect(isolated_url) as other:
            assert other.execute("SELECT pg_try_advisory_xact_lock(428910)").fetchone() == (False,)
        upgrade(config, revision)
        raise RuntimeError("interrupted Alembic upgrade")

    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        try:
            with monkeypatch.context() as patches:
                patches.setattr(manage.command, "upgrade", fail_after_upgrade)
                with pytest.raises(RuntimeError, match="interrupted Alembic upgrade"):
                    manage.migrate()

            with psycopg.connect(isolated_url, autocommit=True) as db:
                assert db.execute("SELECT to_regclass('idea_b_records')").fetchone() == (None,)
                assert db.execute("SELECT to_regclass('alembic_version')").fetchone() == (None,)

                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(manage.migrate)
                    second = pool.submit(manage.migrate)
                    first.result(timeout=10)
                    second.result(timeout=10)

                filenames = db.execute("SELECT filename FROM schema_migrations").fetchall()
                assert {name for (name,) in filenames} >= {
                    "0001_idea_a_records.sql", "0002_idea_b_records.sql",
                }
                assert db.execute("SELECT to_regclass('idea_a_cafes')").fetchone() == (
                    "idea_a_cafes",
                )
                db.execute("INSERT INTO idea_b_records (title) VALUES ('preserved')")
                manage.migrate()
                assert db.execute("SELECT title FROM idea_b_records").fetchone() == ("preserved",)
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))
