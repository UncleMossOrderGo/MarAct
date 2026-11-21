from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base


class CheckoutGroup(Base):
    __tablename__ = "idea_a_checkout_groups"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    shop_id: Mapped[str] = mapped_column(ForeignKey("idea_a_shops.id"))
    idempotency_key: Mapped[str] = mapped_column(Uuid(as_uuid=False), unique=True)


class Fulfillment(Base):
    __tablename__ = "idea_a_order_fulfillment"
    __table_args__ = (
        UniqueConstraint("checkout_group_id", "seller_id"),
        Index("idea_a_order_fulfillment_seller_idx", "seller_id"),
    )

    order_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_orders.id"), primary_key=True
    )
    checkout_group_id: Mapped[str] = mapped_column(
        ForeignKey("idea_a_checkout_groups.id")
    )
    seller_id: Mapped[str] = mapped_column(ForeignKey("idea_a_sellers.id"))
    seller_name: Mapped[str] = mapped_column(Text)
    payment_ref: Mapped[str | None] = mapped_column(Text, unique=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    __tablename__ = "idea_a_notifications"
    __table_args__ = (
        CheckConstraint("recipient_type IN ('shop', 'seller')"),
        UniqueConstraint("recipient_type", "recipient_id", "event_key"),
        Index(
            "idea_a_notifications_recipient_idx",
            "recipient_type",
            "recipient_id",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    recipient_type: Mapped[str] = mapped_column(Text)
    recipient_id: Mapped[str] = mapped_column(Text)
    event_key: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
