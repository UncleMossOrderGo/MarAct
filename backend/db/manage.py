import argparse
from datetime import date, datetime
from pathlib import Path
from typing import cast

import psycopg
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from backend.db.seeds.idea_a import BANGKOK, seed_demo
from backend.db.seeds.idea_a_marketplace import seed_marketplace
from backend.src.shared.db import database_url

DB = Path(__file__).resolve().parent


def migrate() -> None:
    url = database_url()
    engine = create_engine(
        "postgresql+psycopg://", creator=lambda: psycopg.connect(url), poolclass=NullPool
    )
    config = Config()
    config.set_main_option("script_location", str(DB / "alembic"))
    applied_now = []
    try:
        with engine.begin() as connection:
            # Alembic shares this transaction so the existing lock covers both stages.
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(428910)")
            connection.exec_driver_sql(
                "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY)"
            )
            applied = {
                row[0] for row in connection.exec_driver_sql("SELECT filename FROM schema_migrations")
            }
            driver = cast(psycopg.Connection, connection.connection.driver_connection)
            for path in sorted((DB / "migrations").glob("*.sql")):
                if path.name in applied:
                    continue
                with driver.cursor() as cursor:
                    cursor.execute(path.read_text(), prepare=False)
                connection.exec_driver_sql(
                    "INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,)
                )
                applied_now.append(path.name)

            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    finally:
        engine.dispose()

    for filename in applied_now:
        print(f"Applied {filename}")


def seed(idea: str | None, *, planning_date: date | None = None) -> None:
    directories = {
        path.name: path for path in (DB / "seeds").iterdir()
        if path.is_dir() and not path.name.startswith((".", "_"))
    }
    if idea == "--all":
        selected = sorted(directories)
    elif idea in directories:
        selected = [idea]
    else:
        raise SystemExit(f"Choose --all or an idea ID from {', '.join(sorted(directories))}.")

    with psycopg.connect(database_url(), autocommit=True) as connection:
        for idea_id in selected:
            with connection.transaction():
                for path in sorted(directories[idea_id].glob("*.sql")):
                    connection.execute(path.read_text(), prepare=False)
                if idea_id == "idea-a":
                    schema = connection.execute(
                        "SELECT COALESCE(to_regclass('idea_a_shops'), to_regclass('idea_a_cafes'))::text"
                    ).fetchone()
                    if schema and schema[0] == "idea_a_shops":
                        seed_marketplace(connection, planning_date or datetime.now(BANGKOK).date())
                    elif schema and schema[0] == "idea_a_cafes":
                        seed_demo(connection, planning_date or datetime.now(BANGKOK).date())
                    else:
                        print("Skipped Idea A restock fixtures because the schema is pending.")
            print(f"Loaded {idea_id} fixtures")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    seed_command = commands.add_parser("seed")
    selection = seed_command.add_mutually_exclusive_group(required=True)
    selection.add_argument("--idea")
    selection.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if args.command == "migrate":
        migrate()
    else:
        seed("--all" if args.all else args.idea)


if __name__ == "__main__":
    main()
