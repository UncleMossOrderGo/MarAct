import asyncio
import json
import sys
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from backend.src.modules.copilot.agent import create_response, skill_instructions
from backend.src.modules.copilot.language import Language, localized
from backend.src.modules.copilot.personalization import Fruit, InputModel, bangkok_today

PROTOCOL = "2025-11-25"
TOOL = "search_fruit_market"
MODULE = "backend.src.modules.copilot.market_search"


class SearchInput(InputModel):
    fruit: Fruit
    lang: Language = "en"


class Citation(BaseModel):
    title: str
    url: str
    start_index: int
    end_index: int


class MarketContext(BaseModel):
    status: Literal["available", "insufficient_evidence", "unavailable"]
    searched_at: datetime | None = None
    summary: str | None = None
    citations: list[Citation] = Field(default_factory=list)


def cited_context(data: dict) -> MarketContext:
    searched_at = datetime.now(UTC)
    output = data.get("output", [])
    if not any(item.get("type") == "web_search_call" and item.get("status") == "completed" for item in output):
        return MarketContext(status="unavailable")
    for item in output:
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            summary = part.get("text")
            if part.get("type") != "output_text" or not isinstance(summary, str) or not 0 < len(summary) <= 4000:
                continue
            citations = []
            for annotation in part.get("annotations", []):
                if annotation.get("type") != "url_citation":
                    continue
                try:
                    citation = Citation.model_validate(annotation)
                    url = urlsplit(citation.url)
                except ValueError:
                    continue
                if (url.scheme == "https" and url.hostname and not url.username
                        and 0 <= citation.start_index < citation.end_index <= len(summary)):
                    citations.append(citation)
            if citations:
                return MarketContext(status="available", searched_at=searched_at, summary=summary, citations=citations)
    return MarketContext(status="insufficient_evidence", searched_at=searched_at)


def search_market(body: SearchInput) -> MarketContext:
    language = localized(body.lang, "English", "Thai")
    data = create_response({
        "instructions": skill_instructions("market-context"),
        "input": f"Fruit: {body.fruit}. Today in Bangkok: {bangkok_today().isoformat()}. Write in {language}.",
        "tools": [{"type": "web_search"}],
        "tool_choice": "required",
        "max_tool_calls": 3,
        "max_output_tokens": 1600,
    }, timeout=25)
    if data is None:
        return MarketContext(status="unavailable")
    try:
        return cited_context(data)
    except (TypeError, AttributeError):
        return MarketContext(status="unavailable")


def serve() -> None:
    initialized = False
    for line in sys.stdin.buffer:
        try:
            request = json.loads(line)
        except ValueError:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}), flush=True)
            continue
        if not isinstance(request, dict) or request.get("jsonrpc") != "2.0":
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}}), flush=True)
            continue
        method = request.get("method")
        if method == "notifications/initialized":
            initialized = True
        if "id" not in request:
            continue
        response = {"jsonrpc": "2.0", "id": request["id"]}
        if method == "initialize":
            response["result"] = {
                "protocolVersion": PROTOCOL, "capabilities": {"tools": {}},
                "serverInfo": {"name": "maract-market-search", "version": "1.0.0"},
            }
        elif initialized and method == "tools/list":
            response["result"] = {"tools": [{
                "name": TOOL, "description": "Find cited public context for a fruit market in Thailand.",
                "inputSchema": SearchInput.model_json_schema(),
                "outputSchema": MarketContext.model_json_schema(),
                "annotations": {"readOnlyHint": True, "openWorldHint": True},
            }]}
        elif initialized and method == "tools/call":
            params = request.get("params", {})
            try:
                if params.get("name") != TOOL:
                    raise ValueError("Unknown tool")
                result = search_market(SearchInput.model_validate(params.get("arguments")))
                response["result"] = {
                    "structuredContent": result.model_dump(mode="json"),
                    "content": [{"type": "text", "text": result.model_dump_json()}],
                }
            except (ValueError, AttributeError):
                response["error"] = {"code": -32602, "message": "Invalid tool name or arguments"}
        else:
            response["error"] = {"code": -32601, "message": "Method not available"}
        print(json.dumps(response), flush=True)


async def request_market_context(fruit: Fruit, lang: Language) -> MarketContext:
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-m", MODULE,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        writer, reader = process.stdin, process.stdout
        assert writer is not None and reader is not None

        async def send(method: str, params: dict, request_id: int | None = None) -> dict:
            message: dict[str, object] = {"jsonrpc": "2.0", "method": method, "params": params}
            if request_id is not None:
                message["id"] = request_id
            writer.write(json.dumps(message).encode() + b"\n")
            await writer.drain()
            if request_id is None:
                return {}
            reply = json.loads(await reader.readline())
            if reply.get("id") != request_id or not isinstance(reply.get("result"), dict):
                raise ValueError("Invalid MCP response")
            return reply["result"]

        async with asyncio.timeout(32):
            info = await send("initialize", {
                "protocolVersion": PROTOCOL, "capabilities": {},
                "clientInfo": {"name": "maract-idea-b", "version": "1.0.0"},
            }, 1)
            if info.get("protocolVersion") != PROTOCOL:
                raise ValueError("Unsupported MCP protocol")
            await send("notifications/initialized", {})
            result = await send("tools/call", {"name": TOOL, "arguments": {"fruit": fruit, "lang": lang}}, 2)
            return MarketContext.model_validate(result.get("structuredContent"))
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await process.communicate()


def market_context(fruit: Fruit, lang: Language) -> MarketContext:
    try:
        return asyncio.run(request_market_context(fruit, lang))
    except (OSError, ValueError, TypeError, AttributeError):
        return MarketContext(status="unavailable")


if __name__ == "__main__":
    serve()
