from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import OperationalError

from backend.db.alembic.versions import idea_a_0001
from backend.src.shared.db import database_url

STARTER_MIGRATIONS = Path(__file__).resolve().parents[3] / "db" / "migrations"


@pytest.fixture
def postgres_engine() -> Iterator[Engine]:
    """Give each test a fresh schema, including the existing starter migrations."""
    try:
        url = make_url(database_url()).set(drivername="postgresql+psycopg")
    except RuntimeError as exc:
        pytest.skip(str(exc))

    schema = f"test_idea_a_{uuid4().hex}"
    admin = create_engine(url, connect_args={"connect_timeout": 3})
    engine = create_engine(url, connect_args={"options": f"-c search_path={schema}"})
    try:
        try:
            with admin.begin() as connection:
                connection.exec_driver_sql(f"CREATE SCHEMA {schema}")
        except OperationalError as exc:
            pytest.skip(f"PostgreSQL unavailable: {exc.orig}")

        try:
            with engine.begin() as connection:
                for filename in ("0001_idea_a_records.sql", "0002_idea_b_records.sql"):
                    connection.exec_driver_sql((STARTER_MIGRATIONS / filename).read_text())
                connection.exec_driver_sql(
                    "INSERT INTO idea_b_records (title, seed_key) VALUES ('retained', 'starter')"
                )
                with Operations.context(MigrationContext.configure(connection)):
                    idea_a_0001.upgrade()
            yield engine
        finally:
            engine.dispose()
            with admin.begin() as connection:
                connection.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
    finally:
        admin.dispose()


@pytest.fixture
def marketplace_v2_engine(postgres_engine: Engine) -> Engine:
    """Upgrade an isolated v1 fixture for marketplace repository tests."""
    from backend.db.alembic.versions import idea_a_0002

    with (
        postgres_engine.begin() as connection,
        Operations.context(MigrationContext.configure(connection)),
    ):
        idea_a_0002.upgrade()
    return postgres_engine


@pytest.fixture
def marketplace_engine(marketplace_v2_engine: Engine) -> Engine:
    """Upgrade the isolated marketplace fixture to the current revision."""
    from backend.db.alembic.versions import idea_a_0003, idea_a_0004

    with (
        marketplace_v2_engine.begin() as connection,
        Operations.context(MigrationContext.configure(connection)),
    ):
        idea_a_0003.upgrade()
        idea_a_0004.upgrade()
    return marketplace_v2_engine


@pytest.fixture
def daily_marketplace_engine(marketplace_engine: Engine) -> Engine:
    return marketplace_engine
