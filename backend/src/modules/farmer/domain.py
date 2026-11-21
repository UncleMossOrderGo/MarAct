from datetime import date
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Number = Annotated[float, Field(gt=0, le=1_000_000_000, allow_inf_nan=False)]


class Profile(BaseModel):
    name: Annotated[Text, Field(min_length=1)]
    location: Text = ""
    about: Text = ""
    area: Text = ""


class Fields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fruit: Text = ""
    stock_kg: Number | None = None
    price: Number | None = None
    unit: Text = ""
    kg_per_unit: Number | None = None
    min_kg: Number | None = None
    ready: date | None = None
    area: Text = ""

    @model_validator(mode="after")
    def consistent_unit(self):
        if self.unit in ("กก.", "กก", "กิโล", "กิโลกรัม", "kg"):
            self.unit = "กก."
            self.kg_per_unit = 1
        return self


def questions(fields: Fields) -> list[str]:
    checks = [
        (fields.fruit, "ผลไม้ที่จะขายคืออะไรครับ?"),
        (fields.stock_kg, "พร้อมขายทั้งหมดกี่กิโลกรัมครับ?"),
        (fields.price, "ตั้งราคาขายเท่าไหร่ครับ?"),
        (fields.unit, "ราคานี้ต่อกิโล ต่อกล่อง หรือต่อลังครับ?"),
        (fields.kg_per_unit or not fields.unit, "หนึ่งหน่วยขายหนักกี่กิโลกรัมครับ?"),
        (fields.ready, "เริ่มส่งได้วันไหนครับ?"),
        (fields.area, "ส่งได้ในพื้นที่ไหนครับ?"),
    ]
    missing = [question for value, question in checks if not value]
    if fields.min_kg and fields.stock_kg and fields.min_kg > fields.stock_kg:
        missing.append("จำนวนสั่งขั้นต่ำมากกว่าสต็อก ต้องการแก้จำนวนไหนครับ?")
    return missing


REVIEW = "ตรวจร่างแล้วกดยืนยันลงขายได้เลยครับ"


def draft_summary(draft: dict) -> str:
    f = Fields.model_validate(draft["fields"])
    rows = [f.fruit or "ยังไม่ได้ระบุผลไม้"]
    if f.stock_kg is not None:
        rows.append(f"พร้อมขาย {f.stock_kg:g} กก.")
    if f.price is not None:
        rows.append(f"ราคา {f.price:g} บาท" + (f"/{f.unit}" if f.unit else " (รอระบุหน่วย)"))
    if f.kg_per_unit is not None and f.unit and f.unit != "กก.":
        rows.append(f"{f.unit}ละ {f.kg_per_unit:g} กก.")
    if f.min_kg is not None:
        rows.append(f"ขั้นต่ำ {f.min_kg:g} กก.")
    if f.ready:
        rows.append(f"เริ่มส่ง {f.ready}")
    if f.area:
        rows.append(f"ส่งที่ {f.area}")
    if draft["photos"]:
        rows.append(f"มี {len(draft['photos'])} รูป · ใช้รูปที่ {draft['cover'] + 1} เป็นปก")
    return "\n".join(rows)
