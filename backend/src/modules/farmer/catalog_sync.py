"""Project confirmed farm listings into the same catalog used for quotes and checkout."""

import hashlib
import json
import logging
import math
import os
import re
from contextlib import closing
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, ValidationError

from . import router as farm

logger = logging.getLogger(__name__)


class Delivery(BaseModel):
    postcodes: Annotated[
        list[Annotated[str, Field(pattern=r"^[0-9]{2,5}$")]], Field(min_length=1)
    ]
    transit: int = Field(ge=0, le=90)
    freight: int = Field(ge=0, le=1000000)
    window_days: int = Field(ge=1, le=365)


def delivery_rules():
    config = json.loads(os.getenv("MARACT_FARM_DELIVERY") or "{}")
    return {area: Delivery.model_validate(rule) for area, rule in config.items()}


def lot_key(farm_id, item):
    return f"farm-{farm_id}:{item['id']}"


def sync_catalog(cur):
    if not (farm.ROOT / "farm.sqlite").exists():
        return
    try:
        rules = delivery_rules()
    except (ValueError, AttributeError, ValidationError):
        logger.error("Invalid MARACT_FARM_DELIVERY configuration")
        rules = {}
    with closing(farm.connect()) as db:
        rows = db.execute("SELECT id,state FROM farm").fetchall()
    for farm_id, raw in rows:
        state = json.loads(raw)
        for item in state["listings"]:
            fields = item["fields"]
            key = lot_key(farm_id, item)
            policy = rules.get(fields.get("area"))
            # The buyer catalog sells whole units at whole baht. Never invent
            # missing delivery terms or round a farmer's price without consent.
            price = Decimal(str(fields["price"]))
            kg = Decimal(str(fields.get("kg_per_unit") or 0))
            starts = (
                date.fromisoformat(fields["ready"]) if fields.get("ready") else None
            )
            units = (
                int(Decimal(str(fields["stock_kg"])) / kg)
                if kg > 0 and item["available"]
                else 0
            )
            minimum = (
                max(1, math.ceil(Decimal(str(fields.get("min_kg") or 0)) / kg))
                if kg > 0
                else 0
            )
            valid = bool(
                policy
                and starts
                and starts <= date.max - timedelta(days=455)
                and 0 < kg <= 10000
                and 0 < price <= 1000000
                and price == int(price)
                and 0 < minimum <= 1000000
                and units <= 1000000
            )
            cur.execute(
                "SELECT terms_hash FROM market_farm_listing_sync WHERE lot_id=%s",
                (key,),
            )
            previous = cur.fetchone()
            if not valid and not previous:
                continue
            photos = item.get("photos") or []
            index = item.get("cover", 0)
            photo = photos[index] if 0 <= index < len(photos) else ""
            cover_url = (
                f"/api/farmer/marketplace/photos/{photo}"
                if re.fullmatch(r"[0-9a-f]{32}", photo) else None
            )
            signature = hashlib.sha256(
                json.dumps(
                    [
                        state["profile"]["name"],
                        fields,
                        cover_url,
                        item["available"],
                        policy.model_dump() if policy else None,
                    ],
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            if previous and previous["terms_hash"] == signature:
                continue
            if not valid:
                cur.execute(
                    "UPDATE idea_c_lots SET stock=0, postcodes='{}' WHERE id=%s", (key,)
                )
            else:
                assert policy is not None and starts is not None
                ends = starts + timedelta(days=policy.window_days - 1)
                # Rebuild from the farmer's total crop and current reservations.
                # A price edit or repeated webhook must never restore reserved units.
                cur.execute(
                    """SELECT COALESCE(SUM((item->>'units')::integer),0) AS units
                    FROM idea_c_orders CROSS JOIN LATERAL jsonb_array_elements(lines) AS item
                    WHERE state NOT IN ('expired','cancelled','rejected') AND item->>'id'=%s""",
                    (key,),
                )
                remaining = max(0, units - cur.fetchone()["units"])
                cur.execute(
                    """INSERT INTO idea_c_lots
                    (id,farm,name,uses,unit,kg,price,minimum,stock,starts,ends,transit,postcodes,freight,cover_url)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET farm=excluded.farm, name=excluded.name,
                    price=excluded.price, stock=excluded.stock, starts=excluded.starts,
                    ends=excluded.ends, transit=excluded.transit, postcodes=excluded.postcodes,
                    freight=excluded.freight, minimum=excluded.minimum, cover_url=excluded.cover_url""",
                    (
                        key,
                        f"{state['profile']['name']} · #{farm_id}",
                        fields["fruit"],
                        fields["area"],
                        fields["unit"],
                        kg,
                        int(price),
                        minimum,
                        remaining,
                        starts,
                        ends,
                        policy.transit,
                        policy.postcodes,
                        policy.freight,
                        cover_url,
                    ),
                )
            cur.execute(
                """INSERT INTO market_farm_listing_sync VALUES (%s,%s)
                ON CONFLICT(lot_id) DO UPDATE SET terms_hash=excluded.terms_hash""",
                (key, signature),
            )
