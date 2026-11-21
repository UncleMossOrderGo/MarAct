from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import ConnectionPool

from backend.src.modules.idea_a.router import router as idea_a
from backend.src.modules.idea_b.router import router as idea_b
from backend.src.modules.idea_c.router import router as idea_c
from backend.src.shared.db import database_url


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    with ConnectionPool(database_url(), min_size=1, max_size=5, open=False) as pool:
        app.state.pool = pool
        yield


app = FastAPI(title="MarAct", lifespan=lifespan)
app.include_router(idea_a, prefix="/api/ideas/idea-a")
app.include_router(idea_b, prefix="/api/ideas/idea-b")
app.include_router(idea_c, prefix="/api/ideas/idea-c")


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
