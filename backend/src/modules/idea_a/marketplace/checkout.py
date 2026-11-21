from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal, Protocol, Self
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from . import models
from .catalog import Money


class CheckoutItem(BaseModel):
    listing_id: str
    qty_kg: Annotated[int, Field(strict=True, ge=1, le=500)]


class CheckoutRequest(BaseModel):
    shop_id: str
    idempotency_key: UUID
    items: list[CheckoutItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_items(self) -> Self:
        if len({item.listing_id for item in self.items}) != len(self.items):
            raise ValueError("Include each listing only once.")
        return self


class OrderLine(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    listing_id: str
    fruit_id: str
    fruit_name: str
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


class OrderHistory(BaseModel):
    orders: tuple[SavedOrder, ...]


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


def _saved_order(order: models.Order, items: tuple[OrderLine, ...]) -> SavedOrder:
    return SavedOrder(
        id=order.id,
        shop_id=order.shop_id,
        status=order.status,
        total_thb=order.total_thb,
        created_at=order.created_at.astimezone(UTC),
        items=items,
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
        .order_by(models.OrderItem.listing_id)
    )
    for item in session.scalars(statement):
        items_by_order[item.order_id].append(OrderLine.model_validate(item))
    return tuple(
        _saved_order(order, tuple(items_by_order[order.id])) for order in orders
    )


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
            saved = session.scalar(
                select(models.Order).where(models.Order.idempotency_key == key)
            )
            if saved is not None:
                if saved.shop_id != request.shop_id:
                    raise OrderError(409, "idempotency_key_reused")
                return _saved_orders(session, saved)[0], False

            _require_shop(session, request.shop_id)
            quantities = {item.listing_id: item.qty_kg for item in request.items}
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
            order_id = str(uuid4())
            lines: list[models.OrderItem] = []
            for listing_id, quantity in sorted(quantities.items()):
                offer = offers.get(listing_id)
                if offer is None or not offer[0].active:
                    raise OrderError(422, "listing_unavailable", listing_id=listing_id)
                listing, fruit_name, seller_name = offer
                if listing.stock_kg < quantity:
                    raise OrderError(
                        422,
                        "insufficient_stock",
                        listing_id=listing_id,
                        available_kg=listing.stock_kg,
                        requested_kg=quantity,
                    )
                listing.stock_kg -= quantity
                lines.append(
                    models.OrderItem(
                        order_id=order_id,
                        listing_id=listing.id,
                        fruit_id=listing.fruit_id,
                        fruit_name=fruit_name,
                        seller_name=seller_name,
                        qty_kg=quantity,
                        price_per_kg_thb=listing.price_per_kg_thb,
                        line_total_thb=listing.price_per_kg_thb * quantity,
                    )
                )

            order = models.Order(
                id=order_id,
                shop_id=request.shop_id,
                idempotency_key=key,
                status="confirmed",
                total_thb=sum((line.line_total_thb for line in lines), Decimal(0)),
                created_at=self.clock(),
            )
            session.add(order)
            session.flush()
            session.add_all(lines)
            return _saved_order(
                order, tuple(OrderLine.model_validate(line) for line in lines)
            ), True

    def order(self, order_id: str) -> SavedOrder:
        with Session(self.engine) as session:
            order = session.get(models.Order, order_id)
            if order is None:
                raise OrderError(404, "order_not_found", order_id=order_id)
            return _saved_orders(session, order)[0]

    def history(self, shop_id: str) -> tuple[SavedOrder, ...]:
        with Session(self.engine) as session:
            _require_shop(session, shop_id)
            orders = session.scalars(
                select(models.Order)
                .where(models.Order.shop_id == shop_id)
                .order_by(models.Order.created_at.desc(), models.Order.id.desc())
            ).all()
            return _saved_orders(session, *orders)


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

    return router
