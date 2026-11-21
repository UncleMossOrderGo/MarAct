import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg import Error
from psycopg_pool import ConnectionPool, PoolTimeout

from backend.src.legacy.records.router import router as idea_a
from backend.src.legacy.workspace.router import router as idea_b
from backend.src.modules.copilot.router import router as copilot
from backend.src.modules.farmer.accounts import router as farmer_accounts
from backend.src.modules.farmer.line import public as farmer_line
from backend.src.modules.farmer.line import worker as line_worker
from backend.src.modules.farmer.listings import router as farm_listings
from backend.src.modules.farmer.router import router as farmer
from backend.src.modules.marketplace.router import router as marketplace
from backend.src.shared.db import database_url


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    with ConnectionPool(database_url(), min_size=1, max_size=5, open=False) as pool:
        app.state.pool = pool
        app.state.line_wakeup = asyncio.Event()
        task = asyncio.create_task(line_worker(app.state.line_wakeup))
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="MarAct", lifespan=lifespan)
app.include_router(idea_a, prefix="/api/ideas/idea-a")
app.include_router(idea_b, prefix="/api/ideas/idea-b")
app.include_router(marketplace, prefix="/api/ideas/idea-c")
app.include_router(copilot, prefix="/api/ideas/idea-c")
app.include_router(farmer_accounts, prefix="/api/ideas/idea-d")
app.include_router(farmer, prefix="/api/ideas/idea-d")
app.include_router(farmer_line, prefix="/api/ideas/idea-d")
app.include_router(farm_listings, prefix="/api/ideas/idea-d")


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/readiness")
def readiness() -> dict[str, bool]:
    try:
        with app.state.pool.connection(timeout=3) as conn:
            conn.execute("SELECT 1 FROM idea_c_lots LIMIT 1")
            conn.execute("SELECT 1 FROM market_copilot_quota LIMIT 1")
    except (Error, PoolTimeout) as exc:
        raise HTTPException(503, "Marketplace database unavailable") from exc
    return {"ok": True}


frontend = Path(__file__).resolve().parents[3] / "frontend" / "dist"
if (frontend / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/ideas", include_in_schema=False)
    @app.get("/market", include_in_schema=False)
    @app.get("/trends", include_in_schema=False)
    @app.get("/farms", include_in_schema=False)
    @app.get("/farmer", include_in_schema=False)
    @app.get("/login", include_in_schema=False)
    @app.get("/ideas/{path:path}", include_in_schema=False)
    def frontend_page() -> FileResponse:
        return FileResponse(frontend / "index.html")
