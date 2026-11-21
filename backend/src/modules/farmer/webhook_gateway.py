"""Expose only LINE's signed POST endpoint to a development tunnel."""
from http.client import HTTPConnection, HTTPException

from fastapi import FastAPI, Request, Response
from starlette.concurrency import run_in_threadpool

WEBHOOK_PATH = "/api/ideas/idea-d/line/webhook"
app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None, redirect_slashes=False)


def forward(body: bytes, signature: str) -> int:
    # Keep the upstream fixed. Only the raw body and LINE signature cross the boundary.
    conn = HTTPConnection("127.0.0.1", 3000, timeout=8)
    try:
        conn.request("POST", WEBHOOK_PATH, body, headers={
            "Content-Type": "application/json", "X-Line-Signature": signature,
        })
        return conn.getresponse().status
    except (OSError, HTTPException):
        return 503
    finally:
        conn.close()


@app.post(WEBHOOK_PATH)
async def receive(request: Request) -> Response:
    signature = request.headers.get("x-line-signature")
    if not signature:
        return Response(status_code=401)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 2 * 1024 * 1024:
            return Response(status_code=413)
        body.extend(chunk)
    status = await run_in_threadpool(forward, bytes(body), signature)
    return Response(status_code=status)
