from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Cafe(Base):
    __tablename__ = "idea_a_cafes"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)


class Fruit(Base):
    __tablename__ = "idea_a_fruits"
    __table_args__ = (UniqueConstraint("cafe_id", "position"),)

    cafe_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_cafes.id"), primary_key=True
    )
    fruit_id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    position: Mapped[int]


class Usage(Base):
    __tablename__ = "idea_a_usage"
    __table_args__ = (
        ForeignKeyConstraint(
            ("cafe_id", "fruit_id"), ("idea_a_fruits.cafe_id", "idea_a_fruits.fruit_id")
        ),
        CheckConstraint("quantity_kg >= 0"),
    )

    cafe_id: Mapped[str] = mapped_column(Text, primary_key=True)
    fruit_id: Mapped[str] = mapped_column(Text, primary_key=True)
    usage_date: Mapped[date] = mapped_column(primary_key=True)
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric())


class StockSnapshot(Base):
    __tablename__ = "idea_a_stock_snapshots"
    __table_args__ = (
        Index("idea_a_stock_snapshots_cafe_updated_idx", "cafe_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    cafe_id: Mapped[str] = mapped_column(ForeignKey("idea_a_cafes.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StockItem(Base):
    __tablename__ = "idea_a_stock_items"
    __table_args__ = (
        CheckConstraint("use_today_kg >= 0 AND use_today_kg <= stock_kg"),
    )

    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_stock_snapshots.id", ondelete="CASCADE"), primary_key=True
    )
    fruit_id: Mapped[str] = mapped_column(Text, primary_key=True)
    stock_kg: Mapped[Decimal] = mapped_column(Numeric())
    use_today_kg: Mapped[Decimal] = mapped_column(Numeric())


class Plan(Base):
    __tablename__ = "idea_a_plans"
    __table_args__ = (UniqueConstraint("cafe_id", "delivery_date"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    cafe_id: Mapped[str] = mapped_column(ForeignKey("idea_a_cafes.id"))
    delivery_date: Mapped[date]
    delivery_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cutoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("idea_a_stock_snapshots.id"))
    items: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql")
    )


class Draft(Base):
    __tablename__ = "idea_a_drafts"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("idea_a_plans.id"), unique=True)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    items: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql")
    )
    message: Mapped[str] = mapped_column(Text)
