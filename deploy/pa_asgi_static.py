"""
ASGI entry for PythonAnywhere async web app (uvicorn).
Serves Vite Mini App build from ~/poker_room_static.
No third-party deps (pure ASGI).
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

STATIC = Path.home() / "poker_room_static"
ASSET_EXTS = {".js", ".css", ".map", ".woff", ".woff2", ".ttf", ".png", ".jpg", ".svg", ".webp", ".ico"}


async def app(scope, receive, send):
    if scope["type"] != "http":
        return

    path = scope.get("path", "/") or "/"
    if path in ("", "/"):
        candidate = STATIC / "index.html"
        spa_ok = False
    else:
        rel = path.lstrip("/")
        candidate = STATIC / rel
        suffix = Path(rel).suffix.lower()
        spa_ok = True
        if not candidate.is_file():
            if suffix in ASSET_EXTS or rel.startswith("assets/"):
                body = b"Not Found"
                await send(
                    {
                        "type": "http.response.start",
                        "status": 404,
                        "headers": [
                            (b"content-type", b"text/plain"),
                            (b"content-length", str(len(body)).encode()),
                            (b"cache-control", b"no-store"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
            if spa_ok:
                candidate = STATIC / "index.html"

    if not candidate.is_file():
        body = b"Mini App not built. Run deploy/pa_point_web_at_tunnel.sh"
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
    is_index = candidate.name == "index.html"
    is_asset = candidate.parent.name == "assets"
    if is_index:
        cache = b"no-store, no-cache, must-revalidate, max-age=0"
    elif is_asset:
        cache = b"public, max-age=31536000, immutable"
    else:
        cache = b"no-cache"

    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", ctype_b),
                (b"content-length", str(len(data)).encode()),
                (b"cache-control", cache),
            ],
        }
    )
    await send({"type": "http.response.body", "body": data})
