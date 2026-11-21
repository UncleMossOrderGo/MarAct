import hmac
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from threading import Lock

from fastapi import APIRouter, HTTPException, Request

from ..scheduler import BANGKOK


@dataclass(frozen=True)
class TriggerAttempt:
    attempt_id: str
    state: str


@dataclass(frozen=True)
class TriggerSettings:
    token: str = field(default="", repr=False)
    demo_enabled: bool = False
    demo_daily_limit: int = 3

    def __post_init__(self) -> None:
        if self.demo_daily_limit < 1:
            raise ValueError("IDEA_A_DEMO_DAILY_LIMIT must be a positive integer.")

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> "TriggerSettings":
        values = os.environ if environment is None else environment
        return cls(
            token=values.get("IDEA_A_JOB_TOKEN", "").strip(),
            demo_enabled=values.get("IDEA_A_DEMO_TRIGGER_ENABLED", "").strip().lower()
            in {"1", "true"},
            demo_daily_limit=int(values.get("IDEA_A_DEMO_DAILY_LIMIT", "3")),
        )


def _require_same_origin(request: Request) -> None:
    scheme = request.url.scheme
    hostname = request.url.hostname
    if scheme not in {"http", "https"} or hostname is None:
        raise HTTPException(403, detail="Same-origin requests only.")
    try:
        port = request.url.port
    except ValueError:
        raise HTTPException(403, detail="Same-origin requests only.") from None

    host = f"[{hostname}]" if ":" in hostname else hostname
    default_port = 443 if scheme == "https" else 80
    authority = f"{host}:{port}" if port is not None and port != default_port else host
    expected = f"{scheme}://{authority}"
    fetch_site = request.headers.get("sec-fetch-site")
    if request.headers.getlist("origin") != [expected] or fetch_site not in {None, "same-origin"}:
        raise HTTPException(403, detail="Same-origin requests only.")


def daily_trend_trigger_router(
    trigger: Callable[[date], TriggerAttempt],
    *,
    settings: TriggerSettings,
    clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
    active_attempt: Callable[[], TriggerAttempt | None] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/jobs/daily-trend")
    token = settings.token.encode()
    demo_lock = Lock()
    demo_day: date | None = None
    demo_attempts: set[str] = set()

    def bangkok_date() -> date:
        return clock().astimezone(BANGKOK).date()

    @router.post("", status_code=202)
    def operator_trigger(request: Request) -> TriggerAttempt:
        tokens = request.headers.getlist("x-job-token")
        if not token or len(tokens) != 1 or not hmac.compare_digest(tokens[0].encode(), token):
            raise HTTPException(401, detail="Invalid or missing job token.")
        return trigger(bangkok_date())

    @router.post("/demo", status_code=202)
    def demo_trigger(request: Request) -> TriggerAttempt:
        nonlocal demo_day
        if not settings.demo_enabled:
            raise HTTPException(404, detail="Demo trigger is disabled.")
        _require_same_origin(request)

        with demo_lock:
            day = bangkok_date()
            if demo_day != day:
                demo_day = day
                demo_attempts.clear()
            if len(demo_attempts) >= settings.demo_daily_limit:
                if active_attempt is not None and (current := active_attempt()) is not None:
                    return current
                raise HTTPException(429, detail="Daily demo refresh limit reached.")
            attempt = trigger(day)
            demo_attempts.add(attempt.attempt_id)
            return attempt

    return router
