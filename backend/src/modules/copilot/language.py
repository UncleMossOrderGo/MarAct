from datetime import date
from typing import Literal

Language = Literal["en", "th"]

THAI_MONTHS = ("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")


def localized(lang: Language, english: str, thai: str) -> str:
    return thai if lang == "th" else english


def thai_date(day: date) -> str:
    return f"{day.day} {THAI_MONTHS[day.month - 1]} {day.year + 543}"

THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")
