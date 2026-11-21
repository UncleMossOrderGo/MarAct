import json
import os
from datetime import datetime, timedelta, timezone
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field

from .domain import Fields, questions

Intent = Literal["update", "answer", "clarify", "summary"]


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: Intent
    changes: dict[str, str | float | None] = Field(default_factory=dict)
    reply: str = Field(max_length=900)
    question: str = Field(default="", max_length=300)
    resolves_question: bool = False
    cover_number: int | None = None


class Interpretation(BaseModel):
    fields: Fields
    intent: Intent = "update"
    reply: str = ""
    question: str = ""
    cover_number: int | None = None


def apply_turn(draft: dict, turn: Turn) -> Interpretation:
    fields = Fields.model_validate(draft["fields"])
    pending = draft["question"]
    cover = None
    if turn.intent == "update":
        changes = turn.changes.copy()
        if "unit" in changes and changes["unit"] != fields.unit:
            changes.setdefault("kg_per_unit", None)
        fields = Fields.model_validate({**draft["fields"], **changes})
        cover = turn.cover_number
        if turn.resolves_question:
            pending = ""
    if turn.intent in ("update", "clarify") and turn.question.strip():
        pending = turn.question.strip()
    elif turn.intent == "clarify" and not pending:
        pending = "ช่วยบอกอีกครั้งได้ไหมครับว่าต้องการแก้ส่วนไหนของร่าง?"
    reply = turn.reply.strip()
    if turn.intent == "answer" and not reply:
        reply = "อยากทราบเรื่องไหนเกี่ยวกับร่างนี้ครับ?"
    return Interpretation(fields=fields, intent=turn.intent, reply=reply,
                          question=pending, cover_number=cover)


PROMPT = """คุณเป็นผู้ช่วยสวนผลไม้ของ MarAct คุยภาษาไทยกับเจ้าของสวนเพื่อเตรียมประกาศขาย ให้ตอบเหมือนคนที่ฟังอยู่
อ่านข้อมูลร่างปัจจุบันก่อน ตามด้วยบทสนทนาและข้อความใหม่ ตอบ JSON ที่มี:
intent = update (แจ้งหรือสั่งแก้ข้อมูลจริง), answer (ทักทาย ถามข้อมูล ขอคำแนะนำ หรือสมมติ), clarify (คำสั่งกำกวม), summary (ขอดูร่าง)
changes = เฉพาะฟิลด์ที่เจ้าของสวนระบุให้เพิ่มหรือแก้ ห้ามส่งร่างทั้งชุด สำหรับ answer/clarify/summary ให้ส่ง {}
reply = คำตอบไทยสั้น ๆ ตรงคำถาม ใช้หน่วยของเกษตรกร ถ้ามีการแก้ให้ทวนเฉพาะจุดนั้น หลีกเลี่ยงการขึ้นต้นซ้ำ
สำหรับ update ไม่ต้องถามหาข้อมูลที่ยังไม่ได้กรอก ระบบจะถามทีละข้อเอง ถ้า summary ให้ reply ว่าง ระบบจะแสดงตัวเลขจากร่าง
question = คำถามเดียวเฉพาะเมื่อจำเป็นต้องแยกความหมายของข้อความล่าสุด (ไม่ต้องถามซ้ำใน reply) นอกนั้นส่ง ""
resolves_question = true เฉพาะเมื่อคำตอบล่าสุดทำให้ข้อสงสัยใน pending_question ได้ข้อยุติ
cover_number = เลขรูปปก เริ่มที่ 1 เฉพาะเมื่อสั่งเปลี่ยนปก มิฉะนั้น null

ฟิลด์ที่แก้ได้: fruit ชื่อและพันธุ์, stock_kg น้ำหนักรวม, price บาทต่อ unit, unit เช่น กก. หรือ ลัง,
kg_per_unit น้ำหนักต่อหนึ่งหน่วยขาย, min_kg ขั้นต่ำคิดเป็นกิโล, ready วันเริ่มส่งรูปแบบ YYYY-MM-DD, area พื้นที่ส่ง
คิดน้ำหนักรวมจากจำนวนลังคูณน้ำหนักต่อลัง คิดขั้นต่ำจากจำนวนลังเมื่อทราบน้ำหนักต่อลัง เก็บหน่วยที่เกษตรกรใช้
ข้อมูลที่บอกชัดในข้อความก่อนหน้ายังใช้ได้ เช่น รู้ว่ามี 6 ลัง ต่อมาเพิ่งรู้ว่าลังละ 8 โล รวมเป็น 48 กก.
คำตอบสั้น ๆ เช่น “320 ครับ” ให้ดูว่าเพิ่งถามอะไร last messages, pending_question และ next_missing ช่วยระบุ
การบอกจำนวนเป็นกิโลอย่างเดียวไม่ได้แปลว่าตั้งราคาต่อกิโล ห้ามเดาราคา น้ำหนัก หรือข้อมูลจากรูป
ถ้าถาม “ถ้าเอา 2 ลัง รวมกี่บาท” ให้คำนวณจากราคาจริง ตอบพร้อมหน่วย หรือบอกว่าขาดตัวเลขใด ห้ามแก้ราคาสต็อกหรือขั้นต่ำ
ถ้าบอก “ลดเหลือลังละ 300 จำนวนเท่าเดิม” ให้แก้เฉพาะราคาตามที่สั่ง ถ้าเสนอหลายราคาที่ยังตัดสินไม่ได้ให้ถามกลับ
ใช้ today ของไทยแปลงพรุ่งนี้/วันถัดไป ห้ามอ้างว่าลงขายแล้ว การเผยแพร่ต้องให้เจ้าของสวนตรวจและกดยืนยัน
ตอบตามสิ่งที่รู้จากร่างและบทสนทนา ถ้าข้อมูลไม่พอให้บอกตรง ๆ"""


def interpret(draft: dict, message: str) -> Interpretation:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("ยังไม่ได้ตั้งค่า OpenAI API key สามารถกรอกร่างด้วยตนเองได้")
    fields = Fields.model_validate(draft["fields"])
    context = {
        "response_format": "json",
        "today": datetime.now(timezone(timedelta(hours=7))).date().isoformat(),
        "fields": draft["fields"], "history": draft["history"][-12:],
        "pending_question": draft["question"], "next_missing": next(iter(questions(fields)), ""),
        "photo_count": len(draft["photos"]), "cover_number": draft["cover"] + 1 if draft["photos"] else None,
        "message": message,
    }
    result = OpenAI(api_key=key, timeout=30, max_retries=0).responses.create(
        model=os.getenv("OPENAI_MODEL") or "gpt-6.1-terra", instructions=PROMPT, store=False,
        input=json.dumps(context, ensure_ascii=False), text={"format": {"type": "json_object"}},
    )
    return apply_turn(draft, Turn.model_validate_json(result.output_text))
