from collections.abc import Callable, Mapping
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Engine, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .commerce_models import Notification
from .models import Seller, Shop

RecipientType = Literal["shop", "seller"]
NoticeKind = Literal["daily_trend", "order_placed", "order_paid", "order_confirmed"]


def _publish(
    session: Session,
    *,
    recipient_type: RecipientType,
    recipient_id: str,
    event_key: str,
    kind: NoticeKind,
    title: str,
    body: str,
    link: str,
    created_at: datetime,
) -> None:
    session.execute(
        insert(Notification)
        .values(
            id=str(uuid4()),
            recipient_type=recipient_type,
            recipient_id=recipient_id,
            event_key=event_key,
            kind=kind,
            title=title,
            body=body,
            link=link,
            created_at=created_at,
        )
        .on_conflict_do_nothing(
            index_elements=["recipient_type", "recipient_id", "event_key"]
        )
    )


def publish_daily_notifications(
    session: Session,
    trend_date: date,
    trends_by_shop: Mapping[str, str],
    *,
    created_at: datetime,
) -> None:
    for shop_id, title in trends_by_shop.items():
        _publish(
            session,
            recipient_type="shop",
            recipient_id=shop_id,
            event_key=f"daily_trend:{trend_date}",
            kind="daily_trend",
            title="New trends ready for today",
            body=title,
            link="/market/shop",
            created_at=created_at,
        )


def publish_order_notification(
    session: Session,
    *,
    kind: Literal["order_placed", "order_paid", "order_confirmed"],
    order_id: str,
    shop_id: str,
    seller_id: str,
    created_at: datetime,
) -> None:
    titles = {
        "order_placed": "New order received",
        "order_paid": "Order paid",
        "order_confirmed": "Seller confirmed your order",
    }
    is_buyer = kind == "order_confirmed"
    _publish(
        session,
        recipient_type="shop" if is_buyer else "seller",
        recipient_id=shop_id if is_buyer else seller_id,
        event_key=f"{kind}:{order_id}",
        kind=kind,
        title=titles[kind],
        body=f"Order {order_id[:8].upper()}",
        link=f"/market/shop?order={order_id}" if is_buyer else f"/market/shop/seller?order={order_id}",
        created_at=created_at,
    )


class InboxRecipient(BaseModel):
    recipient_type: RecipientType
    recipient_id: str


class NotificationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    title: str
    body: str
    link: str
    read_at: datetime | None
    created_at: datetime


class Inbox(BaseModel):
    notifications: list[NotificationView]
    unread_count: int


def notification_router(
    engine: Engine,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> APIRouter:
    router = APIRouter(prefix="/notifications")

    def scope(session: Session, recipient: InboxRecipient):
        account = Shop if recipient.recipient_type == "shop" else Seller
        if session.get(account, recipient.recipient_id) is None:
            raise HTTPException(404, detail="Recipient not found.")
        return (
            Notification.recipient_type == recipient.recipient_type,
            Notification.recipient_id == recipient.recipient_id,
        )

    @router.get("")
    def inbox(
        recipient_type: RecipientType,
        recipient_id: str,
        since: datetime | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 30,
    ) -> Inbox:
        with Session(engine) as session:
            filters = scope(
                session,
                InboxRecipient(
                    recipient_type=recipient_type,
                    recipient_id=recipient_id,
                ),
            )
            visible = select(Notification).where(*filters)
            if since is not None:
                visible = visible.where(Notification.created_at > since)
            rows = session.scalars(
                visible.order_by(
                    Notification.created_at.desc(),
                    Notification.id,
                ).limit(limit)
            ).all()
            unread = (
                session.scalar(
                    select(func.count())
                    .select_from(Notification)
                    .where(
                        *filters,
                        Notification.read_at.is_(None),
                    )
                )
                or 0
            )
            return Inbox(
                notifications=[NotificationView.model_validate(row) for row in rows],
                unread_count=unread,
            )

    @router.post("/read-all", status_code=204)
    def read_all(recipient: InboxRecipient) -> None:
        with Session(engine) as session, session.begin():
            session.execute(
                update(Notification)
                .where(
                    *scope(session, recipient),
                    Notification.read_at.is_(None),
                )
                .values(read_at=clock())
            )

    @router.post("/{notification_id}/read", status_code=204)
    def read_one(notification_id: str, recipient: InboxRecipient) -> None:
        with Session(engine) as session, session.begin():
            notice = session.scalar(
                select(Notification)
                .where(
                    *scope(session, recipient),
                    Notification.id == notification_id,
                )
                .with_for_update()
            )
            if notice is None:
                raise HTTPException(404, detail="Notification not found.")
            if notice.read_at is None:
                notice.read_at = clock()

    return router
