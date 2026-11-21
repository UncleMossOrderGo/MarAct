import json
import os
from collections.abc import Callable, Sequence
from concurrent.futures import Future
from threading import Lock
from typing import Literal, Protocol, cast

from openai import OpenAI, OpenAIError
from openai.types.shared_params import Reasoning
from pydantic import BaseModel, ConfigDict, ValidationError

from .ranking import RankedFruit


class ExplanationLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fruit_id: str
    explanation: str


class ExplanationBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[ExplanationLine]


def template(item: RankedFruit) -> str:
    offer = item.listings[0]
    fit = f"fits your {item.matching_tag} menu" if item.matching_tag else "is available"
    trend = f", trending: {item.trend_name}" if item.trend_name else ""
    return (
        f"{item.fruit.name_en} {fit}{trend}. "
        f"Suggested {item.suggested_kg} kg from {offer.seller.name} "
        f"at ฿{offer.price_per_kg_thb:.2f}/kg."
    )


class OpenAIFeedExplanations:
    def __init__(self, client: OpenAI | None, model: str, reasoning: Reasoning) -> None:
        self.client = client
        self.model = model
        self.reasoning = reasoning

    @classmethod
    def from_env(cls) -> "OpenAIFeedExplanations":
        key = os.getenv("OPENAI_API_KEY", "").strip()
        model = os.getenv("OPENAI_MODEL", "").strip() or "gpt-6-luna"
        effort = os.getenv("OPENAI_EXPLAIN_EFFORT", "none")
        reasoning = Reasoning(effort="none")
        if effort in ("minimal", "low", "medium", "high", "xhigh"):
            reasoning["effort"] = cast(
                Literal["minimal", "low", "medium", "high", "xhigh"], effort
            )
        return cls(
            OpenAI(api_key=key, timeout=3, max_retries=0) if key else None,
            model,
            reasoning,
        )

    def __call__(self, items: Sequence[RankedFruit], locale: str) -> dict[str, str]:
        if self.client is None:
            return {}

        facts = []
        for item in items:
            offer = item.listings[0]
            facts.append(
                {
                    "fruit_id": item.fruit.id,
                    "fruit": item.fruit.name_en,
                    "fruit_th": item.fruit.name_th,
                    "score": str(item.score),
                    "menu_tag": item.matching_tag,
                    "trend": item.trend_name,
                    "suggested_kg": item.suggested_kg,
                    "seller": offer.seller.name,
                    "price_per_kg_thb": f"{offer.price_per_kg_thb:.2f}",
                }
            )

        try:
            response = self.client.responses.parse(
                model=self.model,
                reasoning=self.reasoning,
                instructions=(
                    "Explain each recommendation in the requested locale. Return plain text, "
                    "at most 25 words per fruit. Use only the supplied facts. Do not quote any "
                    "numeric values or prices; the application displays those separately."
                ),
                input=json.dumps(
                    {"locale": locale, "items": facts}, ensure_ascii=False
                ),
                text_format=ExplanationBatch,
                max_output_tokens=800,
                store=False,
            )
        except (OpenAIError, ValidationError, TimeoutError):
            return {}

        if response.status != "completed" or response.output_parsed is None:
            return {}
        lines = response.output_parsed.items
        output = {line.fruit_id: line.explanation.strip() for line in lines}
        return output if len(lines) == len(output) else {}


class ExplanationStore(Protocol):
    def get(self, feed_key: str, locale: str) -> dict[str, str]: ...
    def save(
        self, feed_key: str, locale: str, explanations: dict[str, str]
    ) -> None: ...


def usable(text: str) -> bool:
    return (
        bool(text)
        and len(text) <= 240
        and len(text.split()) <= 25
        and len(text.splitlines()) == 1
        and not any(character in text for character in "<>`*฿")
        and not any(character.isnumeric() for character in text)
        and any(character.isalpha() for character in text)
    )


class FeedExplanations:
    def __init__(
        self,
        provider: Callable[[Sequence[RankedFruit], str], dict[str, str]],
        store: ExplanationStore,
    ) -> None:
        self.provider = provider
        self.store = store
        self.lock = Lock()
        self.in_flight: dict[tuple[str, str], Future[dict[str, str]]] = {}

    def cached(self, feed_key: str, locale: str) -> dict[str, str]:
        return self.store.get(feed_key, locale)

    def generate(
        self, feed_key: str, locale: str, items: Sequence[RankedFruit]
    ) -> dict[str, str]:
        if not items:
            return {}
        key = (feed_key, locale)
        with self.lock:
            pending = self.in_flight.get(key)
            if pending is None:
                cached = self.cached(feed_key, locale)
                if cached:
                    return cached
                pending = Future()
                self.in_flight[key] = pending
                owner = True
            else:
                owner = False

        if not owner:
            return pending.result()

        try:
            try:
                provided = self.provider(items, locale)
            except (TimeoutError, OpenAIError):
                provided = {}
            validated = {fruit_id: text.strip() for fruit_id, text in provided.items()}
            if validated.keys() != {item.fruit.id for item in items} or not all(
                usable(text) for text in validated.values()
            ):
                validated = {}
            if validated:
                self.store.save(feed_key, locale, validated)
            pending.set_result(validated)
            return validated
        except Exception as error:
            pending.set_exception(error)
            raise
        finally:
            with self.lock:
                del self.in_flight[key]
