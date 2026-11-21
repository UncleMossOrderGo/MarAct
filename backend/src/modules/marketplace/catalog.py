import math
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import HTTPException
from pydantic import BaseModel, Field

Short = Annotated[str, Field(min_length=1, max_length=200)]
Postcode = Annotated[str, Field(pattern=r"^[0-9]{5}$")]


def today():
    return datetime.now(timezone(timedelta(hours=7))).date()


class Pick(BaseModel):
    id: Short
    units: Annotated[int, Field(gt=0, le=1000000)]
    requested_kg: Annotated[int, Field(gt=0, le=1000000)] | None = None


def reasons(lot, units, postcode, arrival):
    result = []
    first = max(today(), lot["starts"]) + timedelta(days=lot["transit"])
    last = lot["ends"] + timedelta(days=lot["transit"])
    if lot["stock"] < units:
        result.append("จำนวนคงเหลือไม่พอ")
    if postcode and not any(postcode.startswith(p) for p in lot["postcodes"]):
        result.append("อยู่นอกพื้นที่จัดส่ง")
    if first > last or (arrival and not first <= arrival <= last):
        result.append("รอบส่งไม่ตรงกับวันรับ")
    return result


def search_lots(cur, *, q="", kg=None, postcode=None, arrival=None, sort="match", preference=""):
    cur.execute("SELECT * FROM idea_c_lots ORDER BY id")
    rows = []
    for lot in cur.fetchall():
        tags = " ".join([lot["name"], lot["farm"], lot["uses"]])
        if q.strip().casefold() not in tags.casefold():
            continue
        units = max(
            lot["minimum"],
            math.ceil(kg / lot["kg"]) if kg and lot["kg"] else lot["minimum"],
        )
        misses = reasons(lot, units, postcode, arrival)
        if kg and not lot["kg"]:
            misses.append("สวนยังไม่ระบุน้ำหนักต่อหน่วย")
        first = max(today(), lot["starts"]) + timedelta(days=lot["transit"])
        rows.append(
            dict(
                lot,
                requested_kg=kg,
                units=units,
                misses=misses,
                earliest=first,
                total=units * lot["price"] + lot["freight"],
                preferred=bool(preference and preference in tags),
            )
        )

    def rank(row):
        by = {
            "match": (-row["preferred"], -row["trend"]),
            "cost": row["total"],
            "date": row["earliest"],
        }
        return (bool(row["misses"]), by[sort], row["id"])

    return sorted(rows, key=rank)


class Basket(BaseModel):
    lines: Annotated[list[Pick], Field(min_length=1, max_length=80)]
    postcode: Postcode
    arrival: date


def quote(cur, basket):
    items = []
    farm = None
    freight = 0
    seen = set()
    for pick in basket.lines:
        cur.execute("SELECT * FROM idea_c_lots WHERE id=%s", (pick.id,))
        lot = cur.fetchone()
        if not lot or pick.id in seen or (farm and farm != lot["farm"]):
            raise HTTPException(422, "เลือกล็อตจากสวนเดียวกันสำหรับแต่ละคำสั่งซื้อ")
        seen.add(pick.id)
        farm = lot["farm"]
        misses = reasons(lot, pick.units, basket.postcode, basket.arrival)
        if lot["kg"] is None and (
            pick.requested_kg is not None or "requested_kg" not in pick.model_fields_set
        ):
            misses.append("สวนยังไม่ระบุน้ำหนักต่อหน่วย กรุณาเลือกซื้อเป็นหน่วย")
        elif pick.requested_kg and pick.units * lot["kg"] < pick.requested_kg:
            misses.append("จำนวนหน่วยไม่ถึงน้ำหนักที่ต้องการ")
        if pick.units < lot["minimum"] or misses:
            raise HTTPException(409, " / ".join(misses) or "ต่ำกว่ายอดขั้นต่ำ")
        freight = max(freight, lot["freight"])
        items.append(
            {
                "id": pick.id,
                "name": lot["name"],
                "unit": lot["unit"],
                "units": pick.units,
                "price": lot["price"],
                "kg": str(lot["kg"]) if lot["kg"] else None,
                **(
                    {"requested_kg": pick.requested_kg}
                    if "requested_kg" in pick.model_fields_set
                    else {}
                ),
            }
        )
    return {
        "farm": farm,
        "lines": items,
        "freight": freight,
        "total": freight + sum(i["price"] * i["units"] for i in items),
    }
