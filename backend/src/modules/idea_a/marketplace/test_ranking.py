from decimal import Decimal as D

from .ranking import Fruit, Listing, Seller, Shop, TrendSignal, UsageTotal, rank

SHOP = Shop("smoothie-cafe", "Smoothie Café", "cafe", ("smoothie", "tropical"))
MANGO = Fruit("mango", "Mango", "มะม่วง", ("smoothie", "tropical"))
BANANA = Fruit("banana", "Banana", "กล้วย", ("smoothie",))
SELLER = Seller("farm", "Farm", "Bangkok", D("4.5"))


def offer(
    id_: str, fruit: Fruit, price: str, stock: int, active: bool = True
) -> Listing:
    return Listing(id_, SELLER, fruit, D(price), stock, active)


def test_rank_personalizes_and_prefers_stock_that_meets_suggestion() -> None:
    listings = (
        offer("b", MANGO, "80", 3),
        offer("a", MANGO, "90", 9),
        offer("c", BANANA, "50", 20),
        offer("empty", MANGO, "30", 0),
        offer("inactive", MANGO, "40", 20, False),
    )
    mango, banana = rank(
        SHOP,
        (UsageTotal("mango", D("50")), UsageTotal("banana", D("25"))),
        listings,
        (TrendSignal("mango", D("0.8"), "Mango smoothies"),),
    )
    assert mango.fruit == MANGO
    assert mango.suggested_kg == 8
    assert mango.score == D("0.84")
    assert [listing.id for listing in mango.listings] == ["a", "b"]
    assert banana.score == D("0.4")


def test_trend_only_quantities_and_price_ties() -> None:
    mango, banana = rank(
        Shop("no-tags", "No tags", "cafe", ()),
        (),
        (
            offer("b", MANGO, "80", 2),
            offer("a", MANGO, "80", 2),
            offer("c", BANANA, "40", 2),
        ),
        (
            TrendSignal("mango", D("0.51"), "Mango"),
            TrendSignal("banana", D("0.5"), "Banana"),
        ),
    )
    assert [item.suggested_kg for item in (mango, banana)] == [2, 0]
    assert [listing.id for listing in mango.listings] == ["a", "b"]
    assert rank(SHOP, (), (offer("empty", MANGO, "1", 0),), ()) == ()
