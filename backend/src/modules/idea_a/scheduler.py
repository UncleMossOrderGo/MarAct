import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date, datetime, time
from threading import Event, Thread
from zoneinfo import ZoneInfo

BANGKOK = ZoneInfo("Asia/Bangkok")
CHECK_TIME = time(6)
logger = logging.getLogger(__name__)


def parse_schedule_time(value: str) -> time:
    try:
        scheduled = datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise ValueError("IDEA_A_SCHEDULE_TIME must be in HH:MM format.") from exc
    if scheduled.strftime("%H:%M") != value:
        raise ValueError("IDEA_A_SCHEDULE_TIME must be in HH:MM format.")
    return scheduled


class DailyCheck:
    def __init__(
        self, run: Callable[[datetime], object], *, at: time = CHECK_TIME,
    ) -> None:
        self._run = run
        self._at = at
        self._last_attempt: date | None = None

    def tick(self, now: datetime) -> None:
        local_now = now.astimezone(BANGKOK)
        today = local_now.date()
        if local_now.time().replace(second=0, microsecond=0) != self._at:
            return
        if self._last_attempt is not None and today <= self._last_attempt:
            return

        self._last_attempt = today
        try:
            self._run(now)
        except Exception:
            logger.exception("Idea A scheduled refresh failed for %s", today)


@contextmanager
def scheduled_checks(
    run: Callable[[datetime], object],
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(BANGKOK),
    at: time = CHECK_TIME,
) -> Iterator[None]:
    worker = DailyCheck(run, at=at)
    stopping = Event()

    def poll() -> None:
        while not stopping.is_set():
            worker.tick(clock())
            stopping.wait(timeout=1)

    thread = Thread(target=poll, name="idea-a-scheduler")
    thread.start()
    try:
        yield
    finally:
        stopping.set()
        thread.join()
