"""
ASGI entry for PythonAnywhere async web app (uvicorn).
Serves Vite Mini App build from ~/poker_room_static.
No third-party deps (pure ASGI).
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

STATIC = Path.home() / "poker_room_static"


async def app(scope, receive, send):
    if scope["type"] != "http":
        return

    path = scope.get("path", "/") or "/"
    if path in ("", "/"):
        candidate = STATIC / "index.html"
    else:
        candidate = STATIC / path.lstrip("/")
        if not candidate.is_file():
            candidate = STATIC / "index.html"

    if not candidate.is_file():
        body = b"Mini App not built. Run deploy/setup_pa.sh"
        await send(
            {
                "type": "http.response.start",
                "status": 404,
                "headers": [
                    (b"content-type", b"text/plain"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
        return

    data = candidate.read_bytes()
    ctype, _ = mimetypes.guess_type(str(candidate))
    ctype_b = (ctype or "application/octet-stream").encode()
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", ctype_b),
                (b"content-length", str(len(data)).encode()),
                (b"cache-control", b"no-cache"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": data})
