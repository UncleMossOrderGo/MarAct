from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSON_DATA = JSON().with_variant(JSONB(), "postgresql")
PRICE = Numeric(14, 2)
TOTAL = Numeric(24, 2)


class Base(DeclarativeBase):
    pass


class Shop(Base):
    __tablename__ = "idea_a_shops"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    menu_tags: Mapped[list[str]] = mapped_column(JSON_DATA)


class Fruit(Base):
    __tablename__ = "idea_a_fruits"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name_en: Mapped[str] = mapped_column(Text)
    name_th: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSON_DATA)


class Usage(Base):
    __tablename__ = "idea_a_usage"
    __table_args__ = (CheckConstraint("quantity_kg >= 0 AND quantity_kg < 'Infinity'"),)

    shop_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_shops.id"), primary_key=True
    )
    fruit_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_fruits.id"), primary_key=True
    )
    usage_date: Mapped[date] = mapped_column(primary_key=True)
    quantity_kg: Mapped[Decimal] = mapped_column(Numeric())


class Seller(Base):
    __tablename__ = "idea_a_sellers"
    __table_args__ = (CheckConstraint("rating BETWEEN 0 AND 5"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    area: Mapped[str] = mapped_column(Text)
    rating: Mapped[Decimal] = mapped_column(Numeric(2, 1))


class Listing(Base):
    __tablename__ = "idea_a_listings"
    __table_args__ = (
        UniqueConstraint("seller_id", "fruit_id"),
        CheckConstraint("price_per_kg_thb >= 0 AND price_per_kg_thb < 'Infinity'"),
        CheckConstraint("stock_kg >= 0"),
        Index("idea_a_listings_fruit_idx", "fruit_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seller_id: Mapped[str] = mapped_column(ForeignKey("idea_a_sellers.id"))
    fruit_id: Mapped[str] = mapped_column(ForeignKey("idea_a_fruits.id"))
    price_per_kg_thb: Mapped[Decimal] = mapped_column(PRICE)
    stock_kg: Mapped[int]
    active: Mapped[bool]


class TrendRun(Base):
    __tablename__ = "idea_a_trend_runs"
    __table_args__ = (
        CheckConstraint("status IN ('ok', 'fallback', 'error')"),
        CheckConstraint("source IN ('live', 'seed')"),
        CheckConstraint("finished_at >= started_at"),
        Index("idea_a_trend_runs_finished_idx", "finished_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)


class Trend(Base):
    __tablename__ = "idea_a_trends"
    __table_args__ = (
        CheckConstraint("confidence BETWEEN 0 AND 1"),
        CheckConstraint("mention_count >= 0"),
        CheckConstraint("score BETWEEN 0 AND 1"),
    )

    run_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_trend_runs.id"), primary_key=True
    )
    fruit_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_fruits.id"), primary_key=True
    )
    trend_name: Mapped[str] = mapped_column(Text)
    rationale: Mapped[str] = mapped_column(Text)
    related_menus: Mapped[list[str]] = mapped_column(JSON_DATA)
    confidence: Mapped[Decimal] = mapped_column(Numeric())
    mention_count: Mapped[int]
    score: Mapped[Decimal] = mapped_column(Numeric())
    sources: Mapped[list[dict[str, str]]] = mapped_column(JSON_DATA)


class Recommendation(Base):
    __tablename__ = "idea_a_recommendations"

    feed_key: Mapped[str] = mapped_column(Text, primary_key=True)
    locale: Mapped[str] = mapped_column(Text, primary_key=True)
    fruit_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_fruits.id"), primary_key=True
    )
    explanation: Mapped[str] = mapped_column(Text)


class Order(Base):
    __tablename__ = "idea_a_orders"
    __table_args__ = (
        CheckConstraint("total_thb >= 0 AND total_thb < 'Infinity'"),
        Index("idea_a_orders_shop_created_idx", "shop_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    shop_id: Mapped[str] = mapped_column(ForeignKey("idea_a_shops.id"))
    idempotency_key: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True)
    status: Mapped[str] = mapped_column(Text)
    total_thb: Mapped[Decimal] = mapped_column(TOTAL)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OrderItem(Base):
    __tablename__ = "idea_a_order_items"
    __table_args__ = (
        CheckConstraint("qty_kg BETWEEN 1 AND 500"),
        CheckConstraint("price_per_kg_thb >= 0 AND price_per_kg_thb < 'Infinity'"),
        CheckConstraint("line_total_thb = price_per_kg_thb * qty_kg"),
    )

    order_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_orders.id"), primary_key=True
    )
    listing_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_listings.id"), primary_key=True
    )
    fruit_id: Mapped[str] = mapped_column(ForeignKey("idea_a_fruits.id"))
    fruit_name: Mapped[str] = mapped_column(Text)
    seller_name: Mapped[str] = mapped_column(Text)
    qty_kg: Mapped[int]
    price_per_kg_thb: Mapped[Decimal] = mapped_column(PRICE)
    line_total_thb: Mapped[Decimal] = mapped_column(TOTAL)
