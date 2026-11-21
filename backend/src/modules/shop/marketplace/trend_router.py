from dataclasses import dataclass
from typing import Protocol

from fastapi import APIRouter

from .trend_cache import RunStatus, TrendRunInfo, TrendSnapshot


class TrendWorkflow(Protocol):
    def latest(self) -> TrendSnapshot: ...
    def refresh(self) -> TrendRunInfo: ...


@dataclass(frozen=True)
class TrendRefreshResponse:
    run_id: str
    status: RunStatus


def trend_router(service: TrendWorkflow) -> APIRouter:
    router = APIRouter()

    @router.post("/trends/run")
    def run_trends() -> TrendRefreshResponse:
        run = service.refresh()
        return TrendRefreshResponse(run.id, run.status)

    @router.get("/trends/latest")
    def latest_trends() -> TrendSnapshot:
        return service.latest()

    return router
