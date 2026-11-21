"""Translate a spoken or typed buying brief into editable trial limits."""

import os
from datetime import date, timedelta

from fastapi import HTTPException
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field, ValidationError


class Brief(BaseModel):
    message: str = Field(min_length=1, max_length=1500)


class TrialLimits(BaseModel):
    budget: int | None
    qty: int | None
    needed_by: str | None


def read_brief(message: str, today: date) -> TrialLimits:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(503, "Speech and text planning is unavailable.")
    try:
        with OpenAI(timeout=15, max_retries=0) as client:
            response = client.responses.parse(
                model=os.getenv("OPENAI_TRIAL_MODEL")
                or os.getenv("OPENAI_MODEL")
                or "gpt-6-luna",
                store=False,
                max_output_tokens=300,
                text_format=TrialLimits,
                instructions=(
                    f"Today in Bangkok is {today.isoformat()} ({today:%A}). Extract only the buyer's "
                    "explicit maximum budget in whole Thai baht, desired whole kilograms for one "
                    "ingredient, and latest acceptable delivery date in YYYY-MM-DD. Resolve Thai or "
                    "English relative dates using today. For an omitted or ambiguous constraint return "
                    "null. Never round fractional quantities, infer quantities from servings, or treat "
                    "numbers per kilogram as a total budget. Never choose a supplier or approve a quote."
                ),
                input=message,
            )
        fields = response.output_parsed
        if fields is None:
            raise ValueError
        if fields.budget is not None and not 1 <= fields.budget <= 1000000:
            raise ValueError
        if fields.qty is not None and not 1 <= fields.qty <= 500:
            raise ValueError
        if fields.needed_by is not None and not today <= date.fromisoformat(
            fields.needed_by
        ) <= today + timedelta(days=366):
            raise ValueError
        if not any((fields.budget, fields.qty, fields.needed_by)):
            raise ValueError
        return fields
    except OpenAIError as exc:
        raise HTTPException(503, "Could not read the trial brief.") from exc
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, "Enter the trial limits directly.") from exc
