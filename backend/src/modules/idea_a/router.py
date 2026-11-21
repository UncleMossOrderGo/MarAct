from collections.abc import Callable
from dataclasses import asdict
from datetime import date, datetime

from fastapi import APIRouter
from sqlalchemy import Engine

from backend.src.shared.records import records_router

from .marketplace.checkout import OrderRepository, orders_router
from .marketplace.daily_job import DailyJob
from .marketplace.daily_reads import DailyReadRepository, daily_read_router
from .marketplace.daily_trigger import (
    TriggerAttempt,
    TriggerSettings,
    daily_trend_trigger_router,
)


def marketplace_router(
    engine: Engine, job: DailyJob, clock: Callable[[], datetime],
) -> APIRouter:
    settings = TriggerSettings.from_env()

    def trigger(day: date) -> TriggerAttempt:
        attempt = job.trigger(day)
        return TriggerAttempt(attempt.id, attempt.state)

    def active_attempt() -> TriggerAttempt | None:
        attempt = job.latest().attempt
        if attempt is not None and attempt.state == "running":
            return TriggerAttempt(attempt.id, attempt.state)
        return None

    def job_status() -> dict[str, object]:
        status = job.latest()
        attempt = asdict(status.attempt) if status.attempt else None
        if attempt is not None:
            attempt["attempt_id"] = attempt.pop("id")
        return {
            "attempt": attempt,
            "latest_usable": status.publication,
            "demo_enabled": settings.demo_enabled,
        }

    router = records_router(
        "SELECT id, title FROM idea_a_records ORDER BY id",
        "INSERT INTO idea_a_records (title) VALUES (%s) RETURNING id, title",
    )
    router.include_router(daily_read_router(DailyReadRepository(engine), job_status))
    router.include_router(daily_trend_trigger_router(
        trigger, settings=settings, clock=clock, active_attempt=active_attempt,
    ))
    router.include_router(orders_router(OrderRepository(engine, clock=clock)))
    return router
