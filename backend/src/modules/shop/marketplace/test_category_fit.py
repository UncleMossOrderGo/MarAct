from dataclasses import replace

from .category_fit import CategoryInsight, CategoryMatcher
from .ingredient_extraction import IngredientMatch
from .test_ingredient_extraction import TREND


def candidate(slug: str, fit: float, priorities: list[str]):
    return {
        "slug": slug,
        "fit": fit,
        "why_fit_en": "Fits the shop menu",
        "why_fit_th": "เข้ากับเมนูร้าน",
        "menu_idea_en": "Gelato cake",
        "menu_idea_th": "เค้กเจลาโต",
        "priority_ingredient_ids": priorities,
    }


def test_category_batches_and_validates_threshold_and_priorities():
    low = replace(TREND, slug="low")
    absent = replace(TREND, slug="absent")
    calls = []
    matches = {
        TREND.slug: [
            IngredientMatch("Pistachio Paste", "paste"),
            IngredientMatch("Milk", "milk"),
            IngredientMatch("Cream", "cream"),
            IngredientMatch("Sugar", "sugar"),
            IngredientMatch("kataifi", None),
        ],
    }

    def transport(category, trends, ingredients):
        calls.append((category, trends, ingredients))
        if category == "juice_shop":
            return {"insights": [candidate(TREND.slug, 0.3, ["Milk"])]}
        return {
            "insights": [
                candidate("unknown", 1, ["paste"]),
                candidate(
                    TREND.slug,
                    0.4,
                    ["invented", "kataifi", "Milk", "paste", "cream", "sugar"],
                ),
                candidate(low.slug, 0.39, []),
            ]
        }

    seeded = CategoryInsight(0.8, "Fits bakery", "เหมาะกับเบเกอรี่", "Cake", "เค้ก", ())
    matcher = CategoryMatcher(transport, seeds={"bakery": {absent.slug: seeded}})
    bakery = matcher("bakery", (TREND, low, absent), matches)
    juice = matcher("juice_shop", (TREND, low, absent), matches)
    assert [call[0] for call in calls] == ["bakery", "juice_shop"]
    assert bakery[TREND.slug].fit == 0.4
    assert bakery[TREND.slug].priority_ingredient_ids == ("milk", "paste", "cream")
    assert bakery[absent.slug] == seeded
    assert set(bakery) == {TREND.slug, absent.slug}
    assert juice == {}


def test_category_failure_filters_seed_priorities_against_current_matches():
    def failure(category, trends, ingredients):
        raise TimeoutError

    seed = CategoryInsight(
        0.8, "Fits bakery", "เหมาะกับเบเกอรี่", "Cake", "เค้ก", ("paste", "milk")
    )
    matcher = CategoryMatcher(failure, seeds={"bakery": {TREND.slug: seed}})
    assert matcher(
        "bakery",
        (TREND,),
        {TREND.slug: (IngredientMatch("Milk", "milk"),)},
    )[TREND.slug].priority_ingredient_ids == ("milk",)
