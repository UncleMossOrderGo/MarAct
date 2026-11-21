from sqlalchemy import Engine, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .models import Recommendation


class SqlExplanationStore:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def get(self, feed_key: str, locale: str) -> dict[str, str]:
        with Session(self.engine) as session:
            rows = session.scalars(
                select(Recommendation).where(
                    Recommendation.feed_key == feed_key,
                    Recommendation.locale == locale,
                )
            )
            return {row.fruit_id: row.explanation for row in rows}

    def save(self, feed_key: str, locale: str, explanations: dict[str, str]) -> None:
        with Session(self.engine) as session, session.begin():
            session.execute(
                insert(Recommendation)
                .values(
                    [
                        {
                            "feed_key": feed_key,
                            "locale": locale,
                            "fruit_id": fruit_id,
                            "explanation": text,
                        }
                        for fruit_id, text in sorted(explanations.items())
                    ]
                )
                .on_conflict_do_nothing()
            )
