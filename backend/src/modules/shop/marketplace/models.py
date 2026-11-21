from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, synonym

JSON_DATA = JSON().with_variant(JSONB(), "postgresql")
PRICE = Numeric(14, 2)
TOTAL = Numeric(24, 2)


class Base(DeclarativeBase):
    pass


class Shop(Base):
    __tablename__ = "idea_a_shops"
    __table_args__ = (
        Index(
            "idea_a_shops_default_idx",
            "is_default",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    menu_tags: Mapped[list[str]] = mapped_column(JSON_DATA)
    is_default: Mapped[bool] = mapped_column(server_default=text("false"))


class Fruit(Base):
    __tablename__ = "idea_a_fruits"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name_en: Mapped[str] = mapped_column(Text)
    name_th: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSON_DATA)

    aliases: Mapped[list[str]] = mapped_column(JSON_DATA, server_default=text("'[]'"))
    category: Mapped[str] = mapped_column(Text, server_default=text("'fruit'"))
    unit: Mapped[str] = mapped_column(Text, server_default=text("'kg'"))
    image_key: Mapped[str | None] = mapped_column(Text)


Ingredient = Fruit


class Usage(Base):
    __tablename__ = "idea_a_usage"
    __table_args__ = (CheckConstraint("quantity_kg >= 0 AND quantity_kg < 'Infinity'"),)

    shop_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_shops.id"), primary_key=True
    )
    fruit_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_fruits.id"), primary_key=True
    )
    ingredient_id = synonym("fruit_id")
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
    ingredient_id = synonym("fruit_id")
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
    line_index: Mapped[int] = mapped_column(
        primary_key=True, server_default=text("nextval('idea_a_order_item_line_index')")
    )
    listing_id: Mapped[str] = mapped_column(ForeignKey("idea_a_listings.id"))
    fruit_id: Mapped[str] = mapped_column(ForeignKey("idea_a_fruits.id"))
    ingredient_id = synonym("fruit_id")
    trend_slug: Mapped[str | None] = mapped_column(Text)
    trend_label: Mapped[str | None] = mapped_column(Text)
    fruit_name: Mapped[str] = mapped_column(Text)
    seller_name: Mapped[str] = mapped_column(Text)
    qty_kg: Mapped[int]
    price_per_kg_thb: Mapped[Decimal] = mapped_column(PRICE)
    line_total_thb: Mapped[Decimal] = mapped_column(TOTAL)


class DailyRun(Base):
    __tablename__ = "idea_a_daily_runs"
    __table_args__ = (
        CheckConstraint("finished_at >= started_at"),
        CheckConstraint("status IN ('ok', 'fallback')"),
        CheckConstraint("source IN ('live', 'seed')"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    trend_date: Mapped[date] = mapped_column(unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)


class DailyTrend(Base):
    __tablename__ = "idea_a_daily_trends"
    __table_args__ = (CheckConstraint("score BETWEEN 0 AND 1"),)

    run_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_daily_runs.id", ondelete="CASCADE"), primary_key=True
    )
    slug: Mapped[str] = mapped_column(Text, primary_key=True)
    name_en: Mapped[str] = mapped_column(Text)
    name_th: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    momentum: Mapped[str] = mapped_column(Text)
    is_new: Mapped[bool]
    why_rising_en: Mapped[str] = mapped_column(Text)
    why_rising_th: Mapped[str] = mapped_column(Text)
    image_key: Mapped[str | None] = mapped_column(Text)
    sources: Mapped[list[dict[str, str]]] = mapped_column(JSON_DATA)
    score: Mapped[Decimal] = mapped_column(Numeric())


class TrendIngredient(Base):
    __tablename__ = "idea_a_daily_trend_ingredients"
    __table_args__ = (
        ForeignKeyConstraint(
            ("run_id", "trend_slug"),
            ("idea_a_daily_trends.run_id", "idea_a_daily_trends.slug"),
            ondelete="CASCADE",
        ),
    )

    run_id: Mapped[str] = mapped_column(Text, primary_key=True)
    trend_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(primary_key=True)
    name_en: Mapped[str] = mapped_column(Text)
    name_th: Mapped[str] = mapped_column(Text)
    ingredient_id: Mapped[str | None] = mapped_column(ForeignKey("idea_a_fruits.id"))


class CategoryInsight(Base):
    __tablename__ = "idea_a_daily_category_insights"
    __table_args__ = (
        ForeignKeyConstraint(
            ("run_id", "trend_slug"),
            ("idea_a_daily_trends.run_id", "idea_a_daily_trends.slug"),
            ondelete="CASCADE",
        ),
        CheckConstraint("fit BETWEEN 0.4 AND 1"),
    )

    run_id: Mapped[str] = mapped_column(Text, primary_key=True)
    trend_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    category: Mapped[str] = mapped_column(Text, primary_key=True)
    fit: Mapped[Decimal] = mapped_column(Numeric())
    why_fit_en: Mapped[str] = mapped_column(Text)
    why_fit_th: Mapped[str] = mapped_column(Text)
    menu_idea_en: Mapped[str] = mapped_column(Text)
    menu_idea_th: Mapped[str] = mapped_column(Text)
    priority_ingredient_ids: Mapped[list[str]] = mapped_column(JSON_DATA)


class DailyRecommendation(Base):
    __tablename__ = "idea_a_daily_recommendations"
    __table_args__ = (
        ForeignKeyConstraint(
            ("run_id", "trend_slug"),
            ("idea_a_daily_trends.run_id", "idea_a_daily_trends.slug"),
            ondelete="CASCADE",
        ),
        UniqueConstraint("run_id", "shop_id", "position"),
    )

    run_id: Mapped[str] = mapped_column(Text, primary_key=True)
    shop_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_shops.id"), primary_key=True
    )
    trend_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int]
    ingredients: Mapped[list[dict[str, object]]] = mapped_column(JSON_DATA)


class DailyJobAttempt(Base):
    __tablename__ = "idea_a_daily_job_attempts"
    __table_args__ = (
        CheckConstraint("state IN ('running', 'published', 'error')"),
        Index("idea_a_daily_attempts_started_idx", "started_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    sequence: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    trend_date: Mapped[date]
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(Text)
    publication_id: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
