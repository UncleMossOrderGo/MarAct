from collections import Counter, defaultdict
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal, Protocol, Self
from uuid import UUID, uuid4, uuid5

from fastapi import APIRouter, HTTPException, Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from . import models
from .catalog import Money
from .commerce_models import CheckoutGroup, Fulfillment
from .notifications import publish_order_notification


class CheckoutItem(BaseModel):
    listing_id: str
    qty_kg: Annotated[int, Field(strict=True, ge=1, le=500)]
    trend_slug: Annotated[str, Field(min_length=1, max_length=120)] | None = None


class CheckoutRequest(BaseModel):
    shop_id: str
    idempotency_key: UUID
    items: list[CheckoutItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_items(self) -> Self:
        if len({(item.listing_id, item.trend_slug) for item in self.items}) != len(
            self.items
        ):
            raise ValueError("Include each listing and trend combination only once.")
        return self


class OrderLine(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    listing_id: str
    fruit_id: str
    fruit_name: str
    ingredient_id: str
    ingredient_name: str = Field(
        validation_alias=AliasChoices("ingredient_name", "fruit_name")
    )
    trend_slug: str | None
    trend_label: str | None
    seller_name: str
    qty_kg: int
    price_per_kg_thb: Money
    line_total_thb: Money


class SavedOrder(BaseModel):
    id: str
    shop_id: str
    status: str
    total_thb: Money
    created_at: datetime
    items: tuple[OrderLine, ...]
    checkout_group_id: str | None = None
    seller_id: str | None = None
    seller_name: str | None = None
    payment_ref: str | None = None
    paid_at: datetime | None = None
    confirmed_at: datetime | None = None
    orders: tuple["SavedOrder", ...] | None = None


class OrderHistory(BaseModel):
    orders: tuple[SavedOrder, ...]


class SellerView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    area: str


class SellerList(BaseModel):
    sellers: tuple[SellerView, ...]


class Payer(BaseModel):
    shop_id: str


class Confirmer(BaseModel):
    seller_id: str


class OrderError(Exception):
    def __init__(
        self, status_code: Literal[404, 409, 422], code: str, **details: str | int
    ) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.detail = {"code": code, **details}


class OrderStore(Protocol):
    def checkout(self, request: CheckoutRequest) -> tuple[SavedOrder, bool]: ...
    def order(self, order_id: str) -> SavedOrder: ...
    def history(self, shop_id: str) -> tuple[SavedOrder, ...]: ...
    def sellers(self) -> tuple[SellerView, ...]: ...
    def incoming(self, seller_id: str) -> tuple[SavedOrder, ...]: ...
    def pay(self, order_id: str, shop_id: str) -> SavedOrder: ...
    def confirm(self, order_id: str, seller_id: str) -> SavedOrder: ...


def _saved_order(
    order: models.Order,
    items: tuple[OrderLine, ...],
    fulfillment: Fulfillment | None,
) -> SavedOrder:
    return SavedOrder(
        id=order.id,
        shop_id=order.shop_id,
        status=order.status,
        total_thb=order.total_thb,
        created_at=order.created_at.astimezone(UTC),
        items=items,
        checkout_group_id=fulfillment.checkout_group_id if fulfillment else None,
        seller_id=fulfillment.seller_id if fulfillment else None,
        seller_name=fulfillment.seller_name if fulfillment else None,
        payment_ref=fulfillment.payment_ref if fulfillment else None,
        paid_at=fulfillment.paid_at.astimezone(UTC)
        if fulfillment and fulfillment.paid_at
        else None,
        confirmed_at=fulfillment.confirmed_at.astimezone(UTC)
        if fulfillment and fulfillment.confirmed_at
        else None,
    )


def _require_shop(session: Session, shop_id: str) -> None:
    if session.get(models.Shop, shop_id) is None:
        raise OrderError(404, "shop_not_found", shop_id=shop_id)


def _saved_orders(session: Session, *orders: models.Order) -> tuple[SavedOrder, ...]:
    if not orders:
        return ()
    items_by_order: dict[str, list[OrderLine]] = {order.id: [] for order in orders}
    statement = (
        select(models.OrderItem)
        .where(models.OrderItem.order_id.in_(items_by_order))
        .order_by(models.OrderItem.line_index)
    )
    for item in session.scalars(statement):
        items_by_order[item.order_id].append(OrderLine.model_validate(item))
    fulfillments = {
        row.order_id: row
        for row in session.scalars(
            select(Fulfillment).where(Fulfillment.order_id.in_(items_by_order))
        )
    }
    return tuple(
        _saved_order(order, tuple(items_by_order[order.id]), fulfillments.get(order.id))
        for order in orders
    )


def _group_order(group: CheckoutGroup, orders: tuple[SavedOrder, ...]) -> SavedOrder:
    if len(orders) == 1:
        return orders[0]
    statuses = {order.status for order in orders}
    status = (
        "placed"
        if "placed" in statuses
        else "paid"
        if "paid" in statuses
        else "confirmed"
    )
    return SavedOrder(
        id=group.id,
        shop_id=group.shop_id,
        checkout_group_id=group.id,
        status=status,
        total_thb=sum((order.total_thb for order in orders), Decimal(0)),
        created_at=orders[0].created_at,
        paid_at=max((order.paid_at for order in orders if order.paid_at), default=None)
        if status in {"paid", "confirmed"}
        else None,
        confirmed_at=max(
            (order.confirmed_at for order in orders if order.confirmed_at), default=None
        )
        if status == "confirmed"
        else None,
        items=tuple(item for order in orders for item in order.items),
        orders=orders,
    )


def _group_children(session: Session, group: CheckoutGroup) -> tuple[SavedOrder, ...]:
    orders = session.scalars(
        select(models.Order)
        .join(Fulfillment, Fulfillment.order_id == models.Order.id)
        .where(Fulfillment.checkout_group_id == group.id)
        .order_by(Fulfillment.seller_id)
    )
    return _saved_orders(session, *orders)


def _trend_labels(session: Session, slugs: set[str]) -> dict[str, str]:
    if not slugs:
        return {}
    rows = session.execute(
        select(
            models.DailyTrend.slug, models.DailyTrend.name_en, models.DailyTrend.name_th
        )
        .join(models.DailyRun, models.DailyRun.id == models.DailyTrend.run_id)
        .where(models.DailyTrend.slug.in_(slugs))
        .order_by(models.DailyRun.trend_date.desc(), models.DailyRun.finished_at.desc())
    )
    labels: dict[str, str] = {}
    for slug, name_en, name_th in rows:
        labels.setdefault(slug, name_en or name_th)
    return labels


class OrderRepository:
    def __init__(
        self,
        engine: Engine,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        self.engine = engine
        self.clock = clock

    def checkout(self, request: CheckoutRequest) -> tuple[SavedOrder, bool]:
        key = str(request.idempotency_key)
        with Session(self.engine) as session, session.begin():
            # Serialize claims even before an order exists. The unique key is a separate
            # database guard. Listing locks serialize different keys competing for stock.
            session.execute(
                select(func.pg_advisory_xact_lock(func.hashtextextended(key, 428911)))
            )
            group = session.scalar(
                select(CheckoutGroup).where(CheckoutGroup.idempotency_key == key)
            )
            if group is not None:
                if group.shop_id != request.shop_id:
                    raise OrderError(409, "idempotency_key_reused")
                return _group_order(group, _group_children(session, group)), False

            saved = session.scalar(
                select(models.Order)
                .outerjoin(
                    Fulfillment,
                    Fulfillment.order_id == models.Order.id,
                )
                .where(
                    models.Order.idempotency_key == key, Fulfillment.order_id.is_(None)
                )
            )
            if saved is not None:
                if saved.shop_id != request.shop_id:
                    raise OrderError(409, "idempotency_key_reused")
                return _saved_orders(session, saved)[0], False

            _require_shop(session, request.shop_id)
            quantities: Counter[str] = Counter()
            for item in request.items:
                quantities[item.listing_id] += item.qty_kg
            offers = {
                listing.id: (listing, fruit_name, seller_name)
                for listing, fruit_name, seller_name in session.execute(
                    select(models.Listing, models.Fruit.name_en, models.Seller.name)
                    .join(models.Fruit, models.Fruit.id == models.Listing.fruit_id)
                    .join(models.Seller, models.Seller.id == models.Listing.seller_id)
                    .where(models.Listing.id.in_(quantities))
                    .order_by(models.Listing.id)
                    .with_for_update(of=models.Listing)
                )
            }
            for listing_id, quantity in sorted(quantities.items()):
                offer = offers.get(listing_id)
                if offer is None or not offer[0].active:
                    raise OrderError(422, "listing_unavailable", listing_id=listing_id)
                listing = offer[0]
                if listing.stock_kg < quantity:
                    raise OrderError(
                        422,
                        "insufficient_stock",
                        listing_id=listing_id,
                        available_kg=listing.stock_kg,
                        requested_kg=quantity,
                    )
                listing.stock_kg -= quantity

            labels = _trend_labels(
                session, {item.trend_slug for item in request.items if item.trend_slug}
            )
            group = CheckoutGroup(
                id=str(uuid4()), shop_id=request.shop_id, idempotency_key=key
            )
            session.add(group)
            session.flush()
            by_seller: dict[str, list[CheckoutItem]] = defaultdict(list)
            for item in request.items:
                by_seller[offers[item.listing_id][0].seller_id].append(item)

            created_at = self.clock()
            snapshots: list[SavedOrder] = []
            for seller_id, seller_items in sorted(by_seller.items()):
                order_id = str(uuid4())
                lines = []
                for position, item in enumerate(seller_items):
                    listing, ingredient_name, seller_name = offers[item.listing_id]
                    lines.append(
                        models.OrderItem(
                            order_id=order_id,
                            line_index=position,
                            listing_id=listing.id,
                            fruit_id=listing.fruit_id,
                            fruit_name=ingredient_name,
                            seller_name=seller_name,
                            qty_kg=item.qty_kg,
                            price_per_kg_thb=listing.price_per_kg_thb,
                            line_total_thb=listing.price_per_kg_thb * item.qty_kg,
                            trend_slug=item.trend_slug,
                            trend_label=labels.get(item.trend_slug)
                            if item.trend_slug
                            else None,
                        )
                    )
                order = models.Order(
                    id=order_id,
                    shop_id=request.shop_id,
                    idempotency_key=str(uuid5(request.idempotency_key, seller_id)),
                    status="placed",
                    total_thb=sum((line.line_total_thb for line in lines), Decimal(0)),
                    created_at=created_at,
                )
                session.add(order)
                session.flush()
                fulfillment = Fulfillment(
                    order_id=order.id,
                    checkout_group_id=group.id,
                    seller_id=seller_id,
                    seller_name=lines[0].seller_name,
                )
                session.add_all([fulfillment, *lines])
                publish_order_notification(
                    session,
                    kind="order_placed",
                    order_id=order.id,
                    shop_id=order.shop_id,
                    seller_id=seller_id,
                    created_at=created_at,
                )
                snapshots.append(
                    _saved_order(
                        order,
                        tuple(OrderLine.model_validate(line) for line in lines),
                        fulfillment,
                    )
                )
            return _group_order(group, tuple(snapshots)), True

    def order(self, order_id: str) -> SavedOrder:
        with Session(self.engine) as session:
            order = session.get(models.Order, order_id)
            if order is not None:
                return _saved_orders(session, order)[0]
            group = session.get(CheckoutGroup, order_id)
            if group is None:
                raise OrderError(404, "order_not_found", order_id=order_id)
            return _group_order(group, _group_children(session, group))

    def history(self, shop_id: str) -> tuple[SavedOrder, ...]:
        with Session(self.engine) as session:
            _require_shop(session, shop_id)
            orders = _saved_orders(
                session,
                *session.scalars(
                    select(models.Order)
                    .where(models.Order.shop_id == shop_id)
                    .order_by(models.Order.created_at.desc(), models.Order.id.desc())
                ),
            )
            groups: dict[str, list[SavedOrder]] = defaultdict(list)
            for order in orders:
                if order.checkout_group_id is not None:
                    groups[order.checkout_group_id].append(order)
            group_rows = (
                {
                    row.id: row
                    for row in session.scalars(
                        select(CheckoutGroup).where(CheckoutGroup.id.in_(groups))
                    )
                }
                if groups
                else {}
            )
            results = []
            for order in orders:
                if order.checkout_group_id is None:
                    results.append(order)
                elif children := groups.pop(order.checkout_group_id, None):
                    children.sort(key=lambda child: child.seller_id or "")
                    results.append(
                        _group_order(
                            group_rows[order.checkout_group_id], tuple(children)
                        )
                    )
            return tuple(results)

    def sellers(self) -> tuple[SellerView, ...]:
        with Session(self.engine) as session:
            sellers = session.scalars(
                select(models.Seller).order_by(models.Seller.name)
            )
            return tuple(SellerView.model_validate(seller) for seller in sellers)

    def incoming(self, seller_id: str) -> tuple[SavedOrder, ...]:
        with Session(self.engine) as session:
            if session.get(models.Seller, seller_id) is None:
                raise OrderError(404, "seller_not_found", seller_id=seller_id)
            orders = session.scalars(
                select(models.Order)
                .join(Fulfillment, Fulfillment.order_id == models.Order.id)
                .where(Fulfillment.seller_id == seller_id)
                .order_by(models.Order.created_at.desc(), models.Order.id.desc())
            )
            return _saved_orders(session, *orders)

    def pay(self, order_id: str, shop_id: str) -> SavedOrder:
        return self._advance(order_id, "paid", shop_id)

    def confirm(self, order_id: str, seller_id: str) -> SavedOrder:
        return self._advance(order_id, "confirmed", seller_id)

    def _advance(
        self,
        order_id: str,
        target: Literal["paid", "confirmed"],
        actor_id: str,
    ) -> SavedOrder:
        with Session(self.engine) as session, session.begin():
            row = session.execute(
                select(models.Order, Fulfillment)
                .join(Fulfillment, Fulfillment.order_id == models.Order.id)
                .where(models.Order.id == order_id)
                .with_for_update()
            ).one_or_none()
            if row is None:
                raise OrderError(404, "order_not_found", order_id=order_id)
            order, fulfillment = row
            expected_actor = (
                order.shop_id if target == "paid" else fulfillment.seller_id
            )
            if actor_id != expected_actor:
                raise OrderError(404, "order_not_found", order_id=order_id)
            if order.status == target or (
                target == "paid" and order.status == "confirmed"
            ):
                return _saved_orders(session, order)[0]
            required = "placed" if target == "paid" else "paid"
            if order.status != required:
                raise OrderError(
                    409, "invalid_order_transition", current_status=order.status
                )
            timestamp = self.clock()
            order.status = target
            if target == "paid":
                fulfillment.payment_ref = f"DEMO-{uuid4().hex.upper()}"
                fulfillment.paid_at = timestamp
            else:
                fulfillment.confirmed_at = timestamp
            publish_order_notification(
                session,
                kind="order_paid" if target == "paid" else "order_confirmed",
                order_id=order.id,
                shop_id=order.shop_id,
                seller_id=fulfillment.seller_id,
                created_at=timestamp,
            )
            return _saved_orders(session, order)[0]


def orders_router(store: OrderStore) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/orders",
        response_model=SavedOrder,
        status_code=201,
        responses={200: {"model": SavedOrder, "description": "Saved order replay"}},
    )
    def checkout(payload: CheckoutRequest, response: Response) -> SavedOrder:
        try:
            order, created = store.checkout(payload)
        except OrderError as error:
            raise HTTPException(error.status_code, detail=error.detail) from error
        if not created:
            response.status_code = 200
        return order

    @router.get("/orders/{order_id}", response_model=SavedOrder)
    def order(order_id: str) -> SavedOrder:
        try:
            return store.order(order_id)
        except OrderError as error:
            raise HTTPException(error.status_code, detail=error.detail) from error

    @router.get("/shops/{shop_id}/orders", response_model=OrderHistory)
    def orders(shop_id: str) -> OrderHistory:
        try:
            return OrderHistory(orders=store.history(shop_id))
        except OrderError as error:
            raise HTTPException(error.status_code, detail=error.detail) from error

    @router.get("/sellers")
    def sellers() -> SellerList:
        return SellerList(sellers=store.sellers())

    @router.get("/sellers/{seller_id}/orders")
    def incoming(seller_id: str) -> OrderHistory:
        try:
            return OrderHistory(orders=store.incoming(seller_id))
        except OrderError as error:
            raise HTTPException(error.status_code, detail=error.detail) from error

    @router.post("/orders/{order_id}/pay")
    def pay(order_id: str, payload: Payer) -> SavedOrder:
        try:
            return store.pay(order_id, payload.shop_id)
        except OrderError as error:
            raise HTTPException(error.status_code, detail=error.detail) from error

    @router.post("/orders/{order_id}/confirm")
    def confirm(order_id: str, payload: Confirmer) -> SavedOrder:
        try:
            return store.confirm(order_id, payload.seller_id)
        except OrderError as error:
            raise HTTPException(error.status_code, detail=error.detail) from error

    return router
