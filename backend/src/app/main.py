import os
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractContextManager, asynccontextmanager, nullcontext
from datetime import datetime
from pathlib import Path

import psycopg
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import ConnectionPool
from sqlalchemy import create_engine

from backend.src.modules.idea_a.marketplace.daily_composition import build_daily_job
from backend.src.modules.idea_a.router import marketplace_router
from backend.src.modules.idea_a.scheduler import (
    BANGKOK,
    parse_schedule_time,
    scheduled_checks,
)
from backend.src.modules.idea_b.router import router as idea_b
from backend.src.shared.db import database_url


def create_app(
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
    schedule: bool | None = None,
) -> FastAPI:
    engine = create_engine(
        "postgresql+psycopg://", creator=lambda: psycopg.connect(database_url()),
    )
    job = build_daily_job(engine, clock)

    def refresh_trends(now: datetime) -> None:
        job.run(now.astimezone(BANGKOK).date())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        try:
            with ConnectionPool(database_url(), min_size=1, max_size=5, open=False) as pool:
                app.state.pool = pool
                enabled = schedule if schedule is not None else os.getenv("IDEA_A_SCHEDULER_ENABLED") == "1"
                worker: AbstractContextManager[None] = nullcontext()
                if enabled:
                    at = parse_schedule_time(os.getenv("IDEA_A_SCHEDULE_TIME", "06:00"))
                    worker = scheduled_checks(refresh_trends, clock=clock, at=at)
                with worker:
                    yield
        finally:
            try:
                job.close()
            finally:
                engine.dispose()

    app = FastAPI(title="MarAct", lifespan=lifespan)
    app.include_router(marketplace_router(engine, job, clock), prefix="/api/ideas/idea-a")
    app.include_router(idea_b, prefix="/api/ideas/idea-b")

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    frontend = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if (frontend / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        @app.get("/ideas", include_in_schema=False)
        @app.get("/ideas/{path:path}", include_in_schema=False)
        def frontend_page() -> FileResponse:
            return FileResponse(frontend / "index.html")

    return app


app = create_app()
