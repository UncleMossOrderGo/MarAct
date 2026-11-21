from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, Protocol

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, PlainSerializer
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from . import models
from .ranking import Fruit, Listing, Seller, Shop, UsageTotal

Money = Annotated[
    Decimal,
    PlainSerializer(
        lambda value: format(value, ".2f"), return_type=str, when_used="json"
    ),
]


class CatalogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ShopResponse(CatalogResponse):
    id: str
    name: str
    category: str
    menu_tags: tuple[str, ...]


class FruitResponse(CatalogResponse):
    id: str
    name_en: str
    name_th: str
    tags: tuple[str, ...]


class SellerResponse(CatalogResponse):
    id: str
    name: str
    area: str
    rating: float


class ListingResponse(CatalogResponse):
    id: str
    seller: SellerResponse
    fruit: FruitResponse
    price_per_kg_thb: Money
    stock_kg: int
    active: bool


class ShopListResponse(BaseModel):
    shops: tuple[ShopResponse, ...]


class ListingListResponse(BaseModel):
    listings: tuple[ListingResponse, ...]


class CatalogReader(Protocol):
    def shops(self) -> tuple[Shop, ...]: ...
    def shop(self, shop_id: str) -> Shop | None: ...
    def fruit(self, fruit_id: str) -> Fruit | None: ...
    def listings(self, fruit_id: str | None = None) -> tuple[Listing, ...]: ...


def _shop(row: models.Shop) -> Shop:
    return Shop(row.id, row.name, row.category, tuple(row.menu_tags))


def _fruit(row: models.Fruit) -> Fruit:
    return Fruit(row.id, row.name_en, row.name_th, tuple(row.tags))


class CatalogRepository:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def shops(self) -> tuple[Shop, ...]:
        with Session(self.engine) as session:
            return tuple(
                _shop(row)
                for row in session.scalars(select(models.Shop).order_by(models.Shop.id))
            )

    def shop(self, shop_id: str) -> Shop | None:
        with Session(self.engine) as session:
            row = session.get(models.Shop, shop_id)
            return _shop(row) if row is not None else None

    def fruits(self) -> tuple[Fruit, ...]:
        with Session(self.engine) as session:
            return tuple(
                _fruit(row)
                for row in session.scalars(
                    select(models.Fruit).order_by(models.Fruit.id)
                )
            )

    def fruit(self, fruit_id: str) -> Fruit | None:
        with Session(self.engine) as session:
            row = session.get(models.Fruit, fruit_id)
            return _fruit(row) if row is not None else None

    def listings(self, fruit_id: str | None = None) -> tuple[Listing, ...]:
        statement = (
            select(models.Listing, models.Seller, models.Fruit)
            .join(models.Seller, models.Seller.id == models.Listing.seller_id)
            .join(models.Fruit, models.Fruit.id == models.Listing.fruit_id)
            .where(models.Listing.active.is_(True))
            .order_by(
                models.Listing.fruit_id,
                models.Listing.price_per_kg_thb,
                models.Listing.id,
            )
        )
        if fruit_id is not None:
            statement = statement.where(models.Listing.fruit_id == fruit_id)
        with Session(self.engine) as session:
            return tuple(
                Listing(
                    listing.id,
                    Seller(seller.id, seller.name, seller.area, seller.rating),
                    _fruit(fruit),
                    listing.price_per_kg_thb,
                    listing.stock_kg,
                    listing.active,
                )
                for listing, seller, fruit in session.execute(statement)
            )

    def usage_totals(self, shop_id: str, planning_date: date) -> tuple[UsageTotal, ...]:
        statement = (
            select(models.Usage.fruit_id, func.sum(models.Usage.quantity_kg))
            .where(
                models.Usage.shop_id == shop_id,
                models.Usage.usage_date >= planning_date - timedelta(days=7),
                models.Usage.usage_date < planning_date,
            )
            .group_by(models.Usage.fruit_id)
            .order_by(models.Usage.fruit_id)
        )
        with Session(self.engine) as session:
            return tuple(
                UsageTotal(fruit_id, total)
                for fruit_id, total in session.execute(statement)
            )


def catalog_router(catalog: CatalogReader) -> APIRouter:
    router = APIRouter()

    @router.get("/shops", response_model=ShopListResponse)
    def shops() -> dict[str, tuple[Shop, ...]]:
        return {"shops": catalog.shops()}

    @router.get("/shops/{shop_id}", response_model=ShopResponse)
    def shop(shop_id: str) -> Shop:
        profile = catalog.shop(shop_id)
        if profile is None:
            raise HTTPException(
                404, detail={"code": "shop_not_found", "shop_id": shop_id}
            )
        return profile

    @router.get("/listings", response_model=ListingListResponse)
    def listings(fruit_id: str | None = None) -> dict[str, tuple[Listing, ...]]:
        if fruit_id is not None and catalog.fruit(fruit_id) is None:
            raise HTTPException(
                404, detail={"code": "fruit_not_found", "fruit_id": fruit_id}
            )
        return {"listings": catalog.listings(fruit_id)}

    return router
