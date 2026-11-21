import argparse
from pathlib import Path

import psycopg

from backend.src.shared.db import database_url

DB = Path(__file__).resolve().parent


def migrate() -> None:
    with psycopg.connect(database_url()) as connection:
        connection.execute("SELECT pg_advisory_xact_lock(428910)")
        connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY)")
        applied = {row[0] for row in connection.execute("SELECT filename FROM schema_migrations")}
        for path in sorted((DB / "migrations").glob("*.sql")):
            if path.name in applied:
                continue
            connection.execute(path.read_text(encoding="utf-8"), prepare=False)
            connection.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,))
            print(f"Applied {path.name}")


def seed(idea: str | None) -> None:
    directories = {path.name: path for path in (DB / "seeds").iterdir() if path.is_dir()}
    aliases = {"idea-a": "records", "idea-b": "workspace", "idea-c": "marketplace"}
    idea = aliases.get(idea, idea) if idea else idea
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
                    connection.execute(path.read_text(encoding="utf-8"), prepare=False)
            print(f"Loaded {idea_id} fixtures")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    seed_command = commands.add_parser("seed")
    selection = seed_command.add_mutually_exclusive_group(required=True)
    selection.add_argument("--domain", "--idea", dest="idea")
    selection.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if args.command == "migrate":
        migrate()
    else:
        seed("--all" if args.all else args.idea)


if __name__ == "__main__":
    main()
