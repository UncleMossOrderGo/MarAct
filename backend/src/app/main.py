import asyncio
import os
from collections.abc import AsyncIterator, Callable
from contextlib import (
    AbstractContextManager,
    asynccontextmanager,
    nullcontext,
    suppress,
)
from datetime import datetime
from pathlib import Path

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import ConnectionPool, PoolTimeout
from sqlalchemy import create_engine

from backend.src.legacy.records.router import router as legacy_records
from backend.src.legacy.workspace.router import router as idea_b
from backend.src.modules.copilot.router import router as copilot
from backend.src.modules.farmer.line import public as line_webhook
from backend.src.modules.farmer.line import worker as line_worker
from backend.src.modules.farmer.marketplace import router as farmer_marketplace
from backend.src.modules.farmer.router import router as farmer
from backend.src.modules.marketplace.router import router as marketplace
from backend.src.modules.shop.marketplace.daily_composition import build_daily_job
from backend.src.modules.shop.router import shop_router
from backend.src.modules.shop.scheduler import (
    BANGKOK,
    parse_schedule_time,
    scheduled_checks,
)
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
                    if not os.getenv("LINE_CHANNEL_SECRET") and not os.getenv("LINE_CHANNEL_ACCESS_TOKEN"):
                        yield
                        return
                    app.state.line_wakeup = asyncio.Event()
                    task = asyncio.create_task(line_worker(app.state.line_wakeup))
                    try:
                        yield
                    finally:
                        task.cancel()
                        with suppress(asyncio.CancelledError):
                            await task
        finally:
            try:
                job.close()
            finally:
                engine.dispose()

    app = FastAPI(title="MarAct", lifespan=lifespan)
    shop = shop_router(engine, job, clock)
    app.include_router(shop, prefix="/api/shop")
    app.include_router(shop, prefix="/api/ideas/idea-a", include_in_schema=False)
    app.include_router(legacy_records, prefix="/api/ideas/idea-a")
    app.include_router(marketplace, prefix="/api/ideas/idea-c")
    app.include_router(copilot, prefix="/api/ideas/idea-c")
    for router in (farmer, line_webhook, farmer_marketplace):
        app.include_router(router, prefix="/api/farmer")
        app.include_router(router, prefix="/api/ideas/idea-d", include_in_schema=False)
    app.include_router(idea_b, prefix="/api/ideas/idea-b")

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/readiness")
    def readiness() -> dict[str, bool]:
        try:
            with app.state.pool.connection(timeout=3) as conn:
                conn.execute("SELECT 1 FROM idea_c_lots LIMIT 1")
                conn.execute("SELECT 1 FROM market_copilot_quota LIMIT 1")
                conn.execute("SELECT 1 FROM idea_a_daily_runs LIMIT 1")
        except (psycopg.Error, PoolTimeout) as exc:
            raise HTTPException(503, "Marketplace database unavailable") from exc
        return {"ok": True}

    frontend = Path(__file__).resolve().parents[3] / "frontend" / "dist"
    if (frontend / "index.html").is_file():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        @app.get("/market", include_in_schema=False)
        @app.get("/market/{path:path}", include_in_schema=False)
        @app.get("/legacy/{path:path}", include_in_schema=False)
        @app.get("/ideas", include_in_schema=False)
        @app.get("/ideas/{path:path}", include_in_schema=False)
        def frontend_page() -> FileResponse:
            return FileResponse(frontend / "index.html")

    return app


app = create_app()
