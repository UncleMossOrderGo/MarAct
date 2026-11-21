import os
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import AbstractContextManager, asynccontextmanager, nullcontext
from datetime import datetime
from pathlib import Path

import psycopg
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import ConnectionPool
from sqlalchemy import create_engine

from backend.db.seeds.idea_a import DEMO_CAFE_ID
from backend.src.modules.idea_a.explanations import OpenAIExplanations
from backend.src.modules.idea_a.planner import BANGKOK, Recommendation
from backend.src.modules.idea_a.repository import SqlAlchemyRepository
from backend.src.modules.idea_a.restock_router import restock_router
from backend.src.modules.idea_a.router import router as idea_a
from backend.src.modules.idea_a.scheduler import parse_schedule_time, scheduled_checks
from backend.src.modules.idea_a.workflow import PlanningService
from backend.src.modules.idea_b.router import router as idea_b
from backend.src.shared.db import database_url


def create_app(
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
    explanations: Callable[[Sequence[Recommendation]], Mapping[str, str]] | None = None,
    schedule: bool | None = None,
) -> FastAPI:
    engine = create_engine(
        "postgresql+psycopg://", creator=lambda: psycopg.connect(database_url()),
    )
    service = PlanningService(
        SqlAlchemyRepository(engine, DEMO_CAFE_ID),
        explanations if explanations is not None else OpenAIExplanations.from_env(),
        clock=clock,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        try:
            with ConnectionPool(database_url(), min_size=1, max_size=5, open=False) as pool:
                app.state.pool = pool
                enabled = schedule if schedule is not None else os.getenv("IDEA_A_SCHEDULER_ENABLED") == "1"
                worker: AbstractContextManager[None] = nullcontext()
                if enabled:
                    at = parse_schedule_time(os.getenv("IDEA_A_SCHEDULE_TIME", "15:30"))
                    worker = scheduled_checks(service.run, clock=clock, at=at)
                with worker:
                    yield
        finally:
            engine.dispose()

    app = FastAPI(title="MarAct", lifespan=lifespan)
    app.include_router(idea_a, prefix="/api/ideas/idea-a")
    app.include_router(restock_router(service), prefix="/api/ideas/idea-a")
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
