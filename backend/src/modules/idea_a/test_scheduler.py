import logging
from datetime import UTC, datetime, time
from threading import Event, Thread, current_thread

import pytest
from pytest import LogCaptureFixture

from backend.src.modules.idea_a.scheduler import (
    DailyCheck,
    parse_schedule_time,
    scheduled_checks,
)


def test_check_runs_in_bangkok_at_15_30_once_per_day() -> None:
    calls: list[datetime] = []
    check = DailyCheck(calls.append)
    first = datetime(2026, 11, 21, 8, 30, tzinfo=UTC)
    second = datetime(2026, 11, 22, 8, 30, tzinfo=UTC)

    check.tick(first.replace(minute=29, second=59))
    check.tick(first.replace(minute=31))
    assert calls == []

    check.tick(first)
    check.tick(first.replace(second=59))
    check.tick(second)
    check.tick(first)

    assert calls == [first, second]


def test_failed_check_is_logged_and_next_day_still_runs(caplog: LogCaptureFixture) -> None:
    calls: list[datetime] = []
    first = datetime(2026, 11, 21, 8, 30, tzinfo=UTC)
    second = datetime(2026, 11, 22, 8, 30, tzinfo=UTC)

    def run(now: datetime) -> None:
        calls.append(now)
        if now == first:
            raise RuntimeError("could not generate plan")

    check = DailyCheck(run)
    check.tick(first)
    check.tick(first)
    check.tick(second)

    assert calls == [first, second]
    assert caplog.record_tuples == [
        (
            "backend.src.modules.idea_a.scheduler",
            logging.ERROR,
            "Idea A scheduled refresh failed for 2026-11-21",
        ),
    ]
    assert caplog.records[0].exc_info is not None


def test_worker_uses_injected_clock_and_joins_on_exit() -> None:
    fired = Event()
    calls: list[tuple[datetime, Thread]] = []
    scheduled_time = datetime(2026, 11, 21, 8, 30, tzinfo=UTC)

    def run(now: datetime) -> None:
        calls.append((now, current_thread()))
        fired.set()

    with scheduled_checks(run, clock=lambda: scheduled_time):
        assert fired.wait(timeout=2)

    [(now, thread)] = calls
    assert now == scheduled_time
    assert thread is not current_thread()
    assert not thread.is_alive()


def test_configured_bangkok_time_is_used() -> None:
    calls: list[datetime] = []
    check = DailyCheck(calls.append, at=parse_schedule_time("09:05"))
    check.tick(datetime(2026, 11, 21, 8, 30, tzinfo=UTC))
    scheduled = datetime(2026, 11, 21, 2, 5, tzinfo=UTC)
    check.tick(scheduled)
    check.tick(scheduled.replace(second=59))
    assert calls == [scheduled]
    assert parse_schedule_time("15:30") == time(15, 30)


@pytest.mark.parametrize("value", ["", "9:05", "24:00", "09:05:00", "09:05+07:00"])
def test_invalid_schedule_time_is_rejected(value: str) -> None:
    with pytest.raises(ValueError, match="HH:MM"):
        parse_schedule_time(value)
