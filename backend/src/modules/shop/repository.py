from collections.abc import Callable
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Engine, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from . import models
from .planner import Fruit, StockItem, StockSnapshot, Usage
from .workflow import Draft, OrderItem, Plan, PlanItem, PlanNotFound, StalePlan


def _plan(row: models.Plan) -> Plan:
    return Plan(
        id=row.id,
        delivery_date=row.delivery_date,
        delivery_at=row.delivery_at,
        cutoff_at=row.cutoff_at,
        generated_at=row.generated_at,
        items=tuple(
            PlanItem(
                fruit_id=item["fruit_id"],
                forecast_kg=Decimal(item["forecast_kg"]),
                usable_stock_kg=Decimal(item["usable_stock_kg"]),
                suggested_kg=item["suggested_kg"],
                shortage=item["shortage"],
                surplus=item["surplus"],
                explanation=item["explanation"],
            )
            for item in row.items
        ),
    )


def _draft(row: models.Draft) -> Draft:
    return Draft(
        id=row.id,
        confirmed_at=row.confirmed_at,
        items=tuple(OrderItem(item["fruit_id"], item["quantity_kg"]) for item in row.items),
        message=row.message,
    )


class SqlAlchemyRepository:
    """Read and write restocking data for one café."""

    def __init__(self, engine: Engine, cafe_id: str) -> None:
        self.engine = engine
        self.cafe_id = cafe_id

    def catalog(self) -> tuple[Fruit, ...]:
        with Session(self.engine) as session:
            rows = session.scalars(
                select(models.Fruit)
                .where(models.Fruit.cafe_id == self.cafe_id)
                .order_by(models.Fruit.position, models.Fruit.fruit_id)
            )
            return tuple(Fruit(row.fruit_id, row.name) for row in rows)

    def recent_usage(self, planning_date: date) -> tuple[Usage, ...]:
        with Session(self.engine) as session:
            rows = session.scalars(
                select(models.Usage)
                .where(
                    models.Usage.cafe_id == self.cafe_id,
                    models.Usage.usage_date >= planning_date - timedelta(days=7),
                    models.Usage.usage_date < planning_date,
                )
                .order_by(models.Usage.usage_date, models.Usage.fruit_id)
            )
            return tuple(Usage(row.fruit_id, row.usage_date, row.quantity_kg) for row in rows)

    def latest_stock(self) -> StockSnapshot | None:
        with Session(self.engine) as session:
            snapshot = session.scalar(
                select(models.StockSnapshot)
                .where(models.StockSnapshot.cafe_id == self.cafe_id)
                .order_by(models.StockSnapshot.updated_at.desc(), models.StockSnapshot.id.desc())
                .limit(1)
            )
            if snapshot is None:
                return None
            items = session.scalars(
                select(models.StockItem)
                .join(
                    models.Fruit,
                    (models.Fruit.cafe_id == self.cafe_id)
                    & (models.Fruit.fruit_id == models.StockItem.fruit_id),
                )
                .where(models.StockItem.snapshot_id == snapshot.id)
                .order_by(models.Fruit.position, models.Fruit.fruit_id)
            )
            return StockSnapshot(
                updated_at=snapshot.updated_at,
                items=tuple(StockItem(item.fruit_id, item.stock_kg, item.use_today_kg) for item in items),
                id=snapshot.id,
            )

    def save_stock(self, snapshot: StockSnapshot) -> StockSnapshot:
        snapshot_id = str(uuid4())
        with Session(self.engine) as session, session.begin():
            session.add(
                models.StockSnapshot(id=snapshot_id, cafe_id=self.cafe_id, updated_at=snapshot.updated_at)
            )
            session.flush()
            session.add_all(
                models.StockItem(
                    snapshot_id=snapshot_id,
                    fruit_id=item.fruit_id,
                    stock_kg=item.stock_kg,
                    use_today_kg=item.use_today_kg,
                )
                for item in snapshot.items
            )
        return StockSnapshot(updated_at=snapshot.updated_at, items=snapshot.items, id=snapshot_id)

    def find_plan_by_date(self, delivery_date: date) -> tuple[Plan, Draft | None] | None:
        return self._find_plan(models.Plan.delivery_date == delivery_date)

    def find_plan_by_id(self, plan_id: str) -> tuple[Plan, Draft | None] | None:
        return self._find_plan(models.Plan.id == plan_id)

    def _find_plan(self, condition: ColumnElement[bool]) -> tuple[Plan, Draft | None] | None:
        with Session(self.engine) as session:
            record = session.execute(
                select(models.Plan, models.Draft)
                .outerjoin(models.Draft, models.Draft.plan_id == models.Plan.id)
                .where(models.Plan.cafe_id == self.cafe_id, condition)
            ).one_or_none()
            if record is None:
                return None
            plan_row, draft_row = record
            return _plan(plan_row), _draft(draft_row) if draft_row is not None else None

    def upsert_plan(self, plan: Plan, snapshot: StockSnapshot) -> tuple[Plan, Draft | None]:
        with Session(self.engine) as session, session.begin():
            stock_row = session.get(models.StockSnapshot, snapshot.id) if snapshot.id else None
            if stock_row is None or stock_row.cafe_id != self.cafe_id:
                raise ValueError("Plan requires a persisted stock snapshot for this café.")

            items = [
                {
                    "fruit_id": item.fruit_id,
                    "forecast_kg": str(item.forecast_kg),
                    "usable_stock_kg": str(item.usable_stock_kg),
                    "suggested_kg": item.suggested_kg,
                    "shortage": item.shortage,
                    "surplus": item.surplus,
                    "explanation": item.explanation,
                }
                for item in plan.items
            ]
            session.execute(
                insert(models.Plan)
                .values(
                    id=plan.id,
                    cafe_id=self.cafe_id,
                    delivery_date=plan.delivery_date,
                    delivery_at=plan.delivery_at,
                    cutoff_at=plan.cutoff_at,
                    generated_at=plan.generated_at,
                    snapshot_id=stock_row.id,
                    items=items,
                )
                .on_conflict_do_nothing(index_elements=[models.Plan.cafe_id, models.Plan.delivery_date])
            )
            # The unique delivery key resolves competing inserts. The row lock
            # then serializes refresh with confirmation of that same plan.
            plan_row = session.scalars(
                select(models.Plan)
                .where(
                    models.Plan.cafe_id == self.cafe_id,
                    models.Plan.delivery_date == plan.delivery_date,
                )
                .with_for_update()
            ).one()
            draft_row = self._saved_draft(session, plan_row.id)
            if draft_row is not None:
                return _plan(plan_row), _draft(draft_row)

            previous_stock = session.scalars(
                select(models.StockSnapshot).where(models.StockSnapshot.id == plan_row.snapshot_id)
            ).one()
            if (stock_row.updated_at, stock_row.id, plan.generated_at) >= (
                previous_stock.updated_at, previous_stock.id, plan_row.generated_at
            ):
                plan_row.delivery_at = plan.delivery_at
                plan_row.cutoff_at = plan.cutoff_at
                plan_row.generated_at = plan.generated_at
                plan_row.snapshot_id = stock_row.id
                plan_row.items = items
            return _plan(plan_row), None

    def confirm_plan(
        self, plan_id: str, current_delivery_date: date, build_draft: Callable[[], Draft]
    ) -> tuple[Plan, Draft]:
        with Session(self.engine) as session, session.begin():
            plan_row = session.scalar(
                select(models.Plan)
                .where(models.Plan.id == plan_id, models.Plan.cafe_id == self.cafe_id)
                .with_for_update()
            )
            if plan_row is None:
                raise PlanNotFound(plan_id)
            saved = self._saved_draft(session, plan_id)
            if saved is not None:
                return _plan(plan_row), _draft(saved)
            if plan_row.delivery_date != current_delivery_date:
                raise StalePlan(plan_id)

            draft = build_draft()
            session.add(
                models.Draft(
                    id=draft.id,
                    plan_id=plan_id,
                    confirmed_at=draft.confirmed_at,
                    items=[
                        {"fruit_id": item.fruit_id, "quantity_kg": item.quantity_kg}
                        for item in draft.items
                    ],
                    message=draft.message,
                )
            )
            return _plan(plan_row), draft

    @staticmethod
    def _saved_draft(session: Session, plan_id: str) -> models.Draft | None:
        return session.scalar(select(models.Draft).where(models.Draft.plan_id == plan_id))
