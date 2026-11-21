"""Serve the real app against disposable, repeatable Playwright fixtures."""

import os
import re
import signal
from datetime import datetime
from tempfile import TemporaryDirectory
from threading import Lock
from unittest.mock import patch
from uuid import uuid4

import psycopg
import uvicorn
from openai.resources.responses import AsyncResponses, Responses
from psycopg import sql
from psycopg.conninfo import make_conninfo

from backend.db.manage import migrate, seed
from backend.src.modules.shop.scheduler import BANGKOK
from backend.src.shared.db import database_url

NOW = datetime(2026, 11, 21, 6, tzinfo=BANGKOK)


def main() -> None:
    # Uvicorn replays SIGTERM after shutdown. Let the runner unwind and drop its schema.
    signal.signal(signal.SIGTERM, lambda _signum, _frame: None)
    base_url = database_url()
    schema_name = os.environ.get("MARACT_BROWSER_SCHEMA") or f"playwright_{uuid4().hex}"
    if not re.fullmatch(r"playwright_[0-9a-f]{32}", schema_name):
        raise ValueError("Invalid Playwright schema name")
    schema = sql.Identifier(schema_name)
    with TemporaryDirectory(prefix="maract-browser-farm-") as farm_data, psycopg.connect(base_url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(schema))
        try:
            isolated_url = make_conninfo(base_url, options=f"-csearch_path={schema_name}")
            os.environ["DATABASE_URL"] = isolated_url
            os.environ.update(
                MARACT_FARM_DATA_DIR=farm_data,
                MARACT_FARM_DELIVERY='{"กรุงเทพฯ":{"postcodes":["10"],"transit":1,"freight":60,"window_days":7}}',
                IDEA_D_DATA_DIR=farm_data,
                LINE_CHANNEL_ACCESS_TOKEN="",
                LINE_CHANNEL_SECRET="",
                OPENAI_API_KEY="",
            )
            os.environ["IDEA_A_USE_SEED_TRENDS"] = "true"
            os.environ["IDEA_A_JOB_TOKEN"] = ""
            os.environ["IDEA_A_DEMO_TRIGGER_ENABLED"] = "true"
            os.environ["IDEA_A_DEMO_DAILY_LIMIT"] = "3"
            migrate()
            seed("--all", planning_date=NOW.date())

            calls = 0
            lock = Lock()

            def reject_provider_call(*_args: object, **_kwargs: object) -> None:
                nonlocal calls
                with lock:
                    calls += 1
                raise AssertionError("The browser demo must use saved or seeded data.")

            with (
                patch.object(Responses, "create", reject_provider_call),
                patch.object(Responses, "parse", reject_provider_call),
                patch.object(AsyncResponses, "create", reject_provider_call),
                patch.object(AsyncResponses, "parse", reject_provider_call),
            ):
                from backend.src.app.main import create_app

                app = create_app(clock=lambda: NOW, schedule=False)

                @app.get("/api/__test/idea-a/provider-calls")
                def provider_calls() -> dict[str, int]:
                    with lock:
                        return {"calls": calls}

                uvicorn.run(app, host="127.0.0.1", port=int(os.environ["API_PORT"]))
        finally:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(schema))


if __name__ == "__main__":
    main()
