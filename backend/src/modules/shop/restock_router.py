from collections.abc import Callable, Coroutine, Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Protocol, Self

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from .planner import StockItem, StockSnapshot
from .workflow import (
    Dashboard,
    InvalidItems,
    MissingInputs,
    OrderItem,
    PlanNotFound,
    StalePlan,
)


class RestockService(Protocol):
    def save_stock(self, items: tuple[StockItem, ...]) -> StockSnapshot: ...
    def current(self) -> Dashboard: ...
    def run(self) -> Dashboard: ...
    def confirm(self, plan_id: str, items: tuple[OrderItem, ...]) -> Dashboard: ...


def require_number(value: object) -> object:
    if type(value) not in (int, float):
        raise ValueError("Use a JSON number for kilograms.")
    return value


StockQuantity = Annotated[
    Decimal, Field(ge=0, allow_inf_nan=False), BeforeValidator(require_number)
]
OrderQuantity = Annotated[int, Field(strict=True, ge=0)]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FruitPayload(Payload):
    fruit_id: str


class StockLine(FruitPayload):
    stock_kg: StockQuantity
    use_today_kg: StockQuantity

    @model_validator(mode="after")
    def check_available_stock(self) -> Self:
        if self.use_today_kg > self.stock_kg:
            raise ValueError("Use-today stock cannot exceed on-hand stock.")
        return self


class OrderLine(FruitPayload):
    quantity_kg: OrderQuantity


def check_unique_ids(items: Sequence[FruitPayload]) -> None:
    if len({item.fruit_id for item in items}) != len(items):
        raise ValueError("Include each fruit ID once.")


class StockPayload(Payload):
    items: list[StockLine] = Field(min_length=1)

    @model_validator(mode="after")
    def check_ids(self) -> Self:
        check_unique_ids(self.items)
        return self


class ConfirmPayload(Payload):
    items: list[OrderLine] = Field(min_length=1)

    @model_validator(mode="after")
    def check_ids(self) -> Self:
        check_unique_ids(self.items)
        return self


class ReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FruitResponse(ReadModel):
    fruit_id: str
    name: str


class StockLineResponse(ReadModel):
    fruit_id: str
    stock_kg: float
    use_today_kg: float


class StockResponse(ReadModel):
    updated_at: datetime
    items: list[StockLineResponse]


class PlanLineResponse(ReadModel):
    fruit_id: str
    forecast_kg: float
    usable_stock_kg: float
    suggested_kg: int
    shortage: bool
    surplus: bool
    explanation: str


class PlanResponse(ReadModel):
    id: str
    delivery_date: date
    delivery_at: datetime
    cutoff_at: datetime
    generated_at: datetime
    items: list[PlanLineResponse]


class OrderLineResponse(ReadModel):
    fruit_id: str
    quantity_kg: int


class DraftResponse(ReadModel):
    id: str
    confirmed_at: datetime
    items: list[OrderLineResponse]
    message: str


class DashboardResponse(ReadModel):
    fruits: list[FruitResponse]
    stock: StockResponse | None
    plan: PlanResponse | None
    draft: DraftResponse | None


class RestockRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handle(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError as error:
                # A rejected non-finite number cannot be echoed in a JSON error response.
                details = [
                    {key: value for key, value in item.items() if key != "input"}
                    for item in error.errors()
                ]
                raise RequestValidationError(details) from error

        return handle


def restock_router(service: RestockService) -> APIRouter:
    router = APIRouter(route_class=RestockRoute)

    @router.put("/stock", response_model=StockResponse)
    def put_stock(payload: StockPayload) -> StockSnapshot:
        try:
            return service.save_stock(
                tuple(
                    StockItem(item.fruit_id, item.stock_kg, item.use_today_kg)
                    for item in payload.items
                )
            )
        except InvalidItems as error:
            raise HTTPException(422, detail=str(error)) from error

    @router.get("/plans/current", response_model=DashboardResponse)
    def current_plan() -> Dashboard:
        return service.current()

    @router.post("/plans/run", response_model=DashboardResponse)
    def run_plan() -> Dashboard:
        try:
            return service.run()
        except MissingInputs as error:
            raise HTTPException(
                409, detail={"code": "missing_inputs", "inputs": error.inputs}
            ) from error

    @router.post("/plans/{plan_id}/confirm", response_model=DashboardResponse)
    def confirm_plan(plan_id: str, payload: ConfirmPayload) -> Dashboard:
        try:
            return service.confirm(
                plan_id,
                tuple(
                    OrderItem(item.fruit_id, item.quantity_kg) for item in payload.items
                ),
            )
        except InvalidItems as error:
            raise HTTPException(422, detail=str(error)) from error
        except PlanNotFound as error:
            raise HTTPException(404, detail={"code": "plan_not_found"}) from error
        except StalePlan as error:
            raise HTTPException(409, detail={"code": "stale_plan"}) from error

    return router
