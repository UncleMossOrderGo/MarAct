"""Serve the real app against disposable, repeatable Playwright fixtures."""

import os
import signal
from datetime import datetime
from uuid import uuid4

import psycopg
import uvicorn
from psycopg import sql
from psycopg.conninfo import make_conninfo

from backend.db.manage import migrate, seed
from backend.src.modules.idea_a.scheduler import BANGKOK
from backend.src.shared.db import database_url

NOW = datetime(2026, 6, 12, 15, 30, tzinfo=BANGKOK)


def main() -> None:
    # Uvicorn replays SIGTERM after shutdown. Let the runner unwind and drop its schema.
    signal.signal(signal.SIGTERM, lambda _signum, _frame: None)
    base_url = database_url()
    schema_name = f"playwright_{uuid4().hex}"
    schema = sql.Identifier(schema_name)
    with psycopg.connect(base_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        try:
            isolated_url = make_conninfo(base_url, options=f"-csearch_path={schema_name}")
            os.environ["DATABASE_URL"] = isolated_url
            os.environ["OPENAI_API_KEY"] = ""
            os.environ["IDEA_A_USE_SEED_TRENDS"] = "true"
            os.environ["IDEA_A_TREND_CACHE_HOURS"] = "0"
            migrate()
            seed("--all", planning_date=NOW.date())

            from backend.src.app.main import create_app

            uvicorn.run(
                create_app(clock=lambda: NOW, schedule=False),
                host="127.0.0.1",
                port=int(os.environ["API_PORT"]),
            )
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))


if __name__ == "__main__":
    main()
