from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from backend.src.modules.copilot.market_search import MarketContext
from backend.src.modules.copilot.personalization import (
    Budget,
    DeliveryDate,
    Fruit,
    InputModel,
    Quantity,
)

Strategy = Literal["lowest_product_price", "personalized_relevance"]
Intent = Literal["search", "personalize", "smart_cart", "trend_discovery", "clarification"]
ToolName = Literal[
    "search_listings", "get_buyer_profile", "build_smart_cart", "repeat_purchase",
    "get_trend_opportunities", "search_fruit_market", "report_unknown", "market_intent",
]


class ToolCall(InputModel):
    name: ToolName
    status: Literal["completed", "error"]
    fruit_id: Fruit | None = Field(default=None, exclude_if=lambda value: value is None)


class SearchRequest(InputModel):
    buyer_id: str = Field(default="buyer_demo_1", max_length=80)
    fruit_query: str = Field(default="", max_length=100)
    quantity_kg: Quantity | None = None
    delivery_by: DeliveryDate | None = None
    mode: Literal["personalized", "general"] = "personalized"
    sort_by: Literal["relevance", "personalized_relevance", "lowest_product_price"] = "relevance"
    max_product_total_thb: Budget | None = None
    preferred_farm_ids: list[str] | None = Field(default=None, max_length=10)
    max_results: int = Field(default=5, ge=1, le=20)


class Product(InputModel):
    listing_id: str
    farm_id: str
    farm_name: str
    fruit_id: str
    product_name: str
    unit_price_thb: Decimal
    available_kg: int
    minimum_order_kg: int
    earliest_delivery: date
    quantity_kg: Decimal | None
    estimated_product_total_thb: Decimal | None
    estimated_shipping_thb: Decimal | None
    score: float
    reasons: list[str]
    warnings: list[str]


class SearchResult(InputModel):
    items: list[Product]
    sort_basis: Strategy
    data_mode: Literal["demo_fixture"] = "demo_fixture"
    warnings: list[str] = Field(default_factory=list)


class RequestedItem(InputModel):
    fruit_query: str = Field(min_length=1, max_length=100)
    quantity_kg: Quantity


class CartRequest(InputModel):
    buyer_id: str = Field(default="buyer_demo_1", max_length=80)
    items: list[RequestedItem] = Field(min_length=1, max_length=10)
    budget_thb: Budget | None = None
    delivery_by: DeliveryDate | None = None
    optimization_goal: Literal["balanced", "lowest_product_price"] = "balanced"
    preferred_farm_ids: list[str] | None = Field(default=None, max_length=10)


class Unfulfilled(InputModel):
    item: RequestedItem
    reason: str


class CartPreview(InputModel):
    status: Literal["proposal_only"] = "proposal_only"
    line_items: list[Product]
    product_subtotal_thb: Decimal
    shipping_total_thb: Decimal | None
    within_product_budget: bool | None
    remaining_product_budget_thb: Decimal | None
    unfulfilled_items: list[Unfulfilled]
    warnings: list[str]
    data_mode: Literal["demo_fixture"] = "demo_fixture"
    requires_user_confirmation: Literal[True] = True


class Opportunity(InputModel):
    fruit_id: Fruit
    fruit_name: str
    signal_type: str
    direction: Literal["rising", "steady", "falling", "insufficient_data"]
    value: float | None
    observation_window: str
    comparison_window: str
    source_name: str
    source_url: str | None = None
    observed_at: datetime
    buyer_fit_reasons: list[str]
    matching_listing_ids: list[str]
    caveat: str
    market_context: MarketContext | None = None


class Opportunities(InputModel):
    opportunities: list[Opportunity]
    data_mode: Literal["demo_fixture"] = "demo_fixture"


class ChatRequest(InputModel):
    buyer_id: str = Field(default="buyer_demo_1", max_length=80)
    message: str = Field(min_length=1, max_length=600)
    conversation_id: str | None = Field(default=None, max_length=80)
    previous_search: SearchRequest | None = None


class ChatResponse(InputModel):
    intent: Intent
    message: str
    products: list[Product] = Field(default_factory=list)
    suggested_cart: CartPreview | None = None
    trend_opportunities: list[Opportunity] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    data_mode: Literal["demo_fixture"] = "demo_fixture"
    conversation_id: str
    source: Literal["deterministic", "openai"]
    search_context: SearchRequest | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
