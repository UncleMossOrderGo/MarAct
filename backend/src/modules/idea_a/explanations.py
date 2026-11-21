import json
import os
from collections.abc import Sequence
from dataclasses import asdict

from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ConfigDict, ValidationError

from .planner import Recommendation

DEFAULT_MODEL = "gpt-6-luna"


class Explanation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fruit_id: str
    text: str


class ExplanationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[Explanation]


def template(item: Recommendation) -> str:
    if item.shortage and item.surplus:
        return "Some stock needs to be used today, and usable stock at delivery is below forecast."
    if item.shortage:
        return "Usable stock at delivery is below the forecast."
    return "More stock needs to be used today than projected demand can absorb."


class OpenAIExplanations:
    def __init__(self, client: OpenAI | None, model: str = DEFAULT_MODEL) -> None:
        self.client = client
        self.model = model

    @classmethod
    def from_env(cls) -> "OpenAIExplanations":
        key = os.getenv("OPENAI_API_KEY", "").strip()
        model = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_MODEL
        return cls(
            OpenAI(api_key=key, timeout=5.0, max_retries=0) if key else None, model
        )

    def __call__(self, items: Sequence[Recommendation]) -> dict[str, str]:
        flagged = tuple(item for item in items if item.shortage or item.surplus)
        fallback = {item.fruit_id: template(item) for item in flagged}
        if self.client is None or not flagged:
            return fallback

        try:
            response = self.client.responses.parse(
                model=self.model,
                instructions=(
                    "For each fruit ID, explain its supplied risk flags in one short plain-text "
                    "sentence. Use only the computed facts. Do not recalculate or change quantities."
                ),
                input=json.dumps([asdict(item) for item in flagged], default=str),
                text_format=ExplanationResponse,
                store=False,
            )
        except (OpenAIError, TimeoutError, ValidationError):
            return fallback

        parsed = response.output_parsed
        if response.status != "completed" or parsed is None:
            return fallback
        explanations = {item.fruit_id: item.text.strip() for item in parsed.items}
        if (
            len(explanations) != len(parsed.items)
            or explanations.keys() != fallback.keys()
            or any(
                not text
                or len(text) > 240
                or len(text.splitlines()) != 1
                or any(character in text for character in "<>`*")
                or not any(character.isalnum() for character in text)
                for text in explanations.values()
            )
        ):
            return fallback
        return explanations
