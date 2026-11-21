from dataclasses import replace

from .daily_discovery import DailyTrend, IngredientCatalogItem
from .ingredient_extraction import (
    IngredientExtractor,
    IngredientMatch,
    match_ingredient_names,
)

TREND = DailyTrend(
    "pistachio-gelato",
    "Pistachio Gelato",
    "เจลาโตพิสตาชิโอ",
    "dessert",
    "rising",
    "Popular in bakeries",
    "นิยมในร้านเบเกอรี่",
    0.8,
    (),
)
CATALOG = (
    IngredientCatalogItem(
        "paste", "Pistachio Paste", "พิสตาชิโอบด", ("nut paste", "spread")
    ),
    IngredientCatalogItem("milk", "Milk", "นม", ("spread",)),
)


def test_unicode_alias_deduplication_and_ambiguous_name():
    assert match_ingredient_names(
        [
            "  ＰＩＳＴＡＣＨＩＯ　 Paste   ",
            "nut paste",
            "นม",
            "spread",
            "kataifi topping",
        ],
        CATALOG,
    ) == (
        IngredientMatch("ＰＩＳＴＡＣＨＩＯ Paste", "paste"),
        IngredientMatch("นม", "milk"),
        IngredientMatch("spread", None),
        IngredientMatch("kataifi topping", None),
    )


def test_extraction_batches_caps_and_falls_back_for_missing_trends(caplog):
    other = replace(TREND, slug="seed-known")
    unknown = replace(TREND, slug="unknown")
    calls = []

    def transport(trends, catalog):
        calls.append((trends, catalog))
        return {
            "trends": [
                {
                    "slug": TREND.slug,
                    "ingredients": ["Milk", *[f"missing {i}" for i in range(7)]],
                },
                {"slug": other.slug, "ingredients": 55},
                {"slug": "invented", "ingredients": ["Milk"]},
            ]
        }

    extractor = IngredientExtractor(transport, seeds={other.slug: ("nut paste",)})
    caplog.set_level("INFO")
    matches = extractor((TREND, other, unknown), CATALOG)
    assert len(calls) == 1
    assert len(matches[TREND.slug]) == 6
    assert matches[TREND.slug][0] == IngredientMatch("Milk", "milk")
    assert matches[other.slug] == (IngredientMatch("nut paste", "paste"),)
    assert matches[unknown.slug] == ()
    assert "Unmatched ingredient for pistachio-gelato: missing 0" in caplog.text


def test_extraction_uses_seed_when_batch_times_out():
    def timeout(trends, catalog):
        raise TimeoutError

    extractor = IngredientExtractor(timeout, seeds={TREND.slug: ("Pistachio Paste",)})
    assert extractor((TREND,), CATALOG)[TREND.slug][0].ingredient_id == "paste"
