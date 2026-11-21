from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from .daily_trigger import TriggerAttempt, TriggerSettings, daily_trend_trigger_router

PATH = "/api/ideas/idea-a/jobs/daily-trend"
SAME_ORIGIN = {"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"}
NOW = datetime(2026, 11, 20, 23, tzinfo=UTC)


def client_for(
    trigger: Callable[[date], TriggerAttempt],
    settings: TriggerSettings | None = None,
    *,
    clock: Callable[[], datetime] = lambda: NOW,
    active_attempt: Callable[[], TriggerAttempt | None] | None = None,
) -> TestClient:
    app = FastAPI()
    app.include_router(
        daily_trend_trigger_router(
            trigger, settings=settings or TriggerSettings(), clock=clock, active_attempt=active_attempt,
        ),
        prefix="/api/ideas/idea-a",
    )
    return TestClient(app)


def test_trigger_settings_are_opt_in_and_hide_secret() -> None:
    assert TriggerSettings.from_env({}) == TriggerSettings()
    settings = TriggerSettings.from_env({
        "IDEA_A_JOB_TOKEN": "private-token",
        "IDEA_A_DEMO_TRIGGER_ENABLED": "true",
        "IDEA_A_DEMO_DAILY_LIMIT": "2",
    })
    assert settings.demo_enabled and settings.demo_daily_limit == 2
    assert settings.token == "private-token"
    assert "private-token" not in repr(settings)
    with pytest.raises(ValueError, match="positive integer"):
        TriggerSettings.from_env({"IDEA_A_DEMO_DAILY_LIMIT": "0"})


def test_operator_requires_one_valid_token_and_resolves_bangkok_date() -> None:
    days: list[date] = []

    def trigger(day: date) -> TriggerAttempt:
        days.append(day)
        return TriggerAttempt("attempt", "running")

    with client_for(trigger, TriggerSettings(token="operator")) as client:
        assert client.post(PATH).status_code == 401
        assert client.post(PATH, headers={"X-Job-Token": "invalid"}).status_code == 401
        duplicated = [("X-Job-Token", "operator"), ("X-Job-Token", "operator")]
        assert client.post(PATH, headers=duplicated).status_code == 401
        assert days == []

        response = client.post(PATH, headers={"X-Job-Token": "operator"})
        assert response.status_code == 202
        assert response.json() == {"attempt_id": "attempt", "state": "running"}
        assert days == [date(2026, 11, 21)]


def test_disabled_configuration_rejects_both_triggers() -> None:
    def trigger(_: date) -> TriggerAttempt:
        pytest.fail("disabled triggers must not start the job")

    with client_for(trigger) as client:
        assert client.post(PATH, headers={"X-Job-Token": "operator"}).status_code == 401
        assert client.post(f"{PATH}/demo", headers=SAME_ORIGIN).status_code == 404


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "null"},
        {"Origin": "https://testserver"},
        {"Origin": "http://testserver:123"},
        {"Origin": "http://other.example"},
        {"Origin": "http://testserver", "Sec-Fetch-Site": "cross-site"},
    ],
)
def test_demo_requires_same_origin(headers: dict[str, str]) -> None:
    def trigger(_: date) -> TriggerAttempt:
        pytest.fail("invalid origins must not start the job")

    with client_for(trigger, TriggerSettings(demo_enabled=True)) as client:
        assert client.post(f"{PATH}/demo", headers=headers).status_code == 403


def test_duplicate_demo_requests_share_attempt_and_limit_resets_next_day() -> None:
    now = NOW
    active: TriggerAttempt | None = None
    calls: list[date] = []

    def trigger(day: date) -> TriggerAttempt:
        nonlocal active
        calls.append(day)
        if active is None:
            active = TriggerAttempt(f"attempt-{len(calls)}", "running")
        return active

    settings = TriggerSettings(token="operator", demo_enabled=True, demo_daily_limit=2)
    with client_for(trigger, settings, clock=lambda: now, active_attempt=lambda: active) as client:
        demo = f"{PATH}/demo"
        first = client.post(demo, headers=SAME_ORIGIN)
        assert first.status_code == 202
        assert client.post(demo, headers=SAME_ORIGIN).json() == first.json()
        assert client.post(PATH, headers={"X-Job-Token": "operator"}).json() == first.json()

        active = None
        second = client.post(demo, headers=SAME_ORIGIN)
        assert second.status_code == 202
        assert second.json() != first.json()
        assert client.post(demo, headers=SAME_ORIGIN).json() == second.json()

        active = None
        assert client.post(demo, headers=SAME_ORIGIN).status_code == 429
        now += timedelta(days=1)
        assert client.post(demo, headers=SAME_ORIGIN).status_code == 202
        assert calls == [date(2026, 11, 21)] * 4 + [date(2026, 11, 22)]


def test_trigger_returns_attempt_state_for_status_polling() -> None:
    with client_for(lambda _: TriggerAttempt("attempt", "timeout"), TriggerSettings(token="operator")) as client:
        response = client.post(PATH, headers={"X-Job-Token": "operator"})
        assert response.status_code == 202
        assert response.json() == {"attempt_id": "attempt", "state": "timeout"}
