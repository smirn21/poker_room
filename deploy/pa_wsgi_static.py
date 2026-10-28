"""
PythonAnywhere WSGI: serve Vite Mini App with correct cache headers.
- index.html: no-store (Telegram WebView otherwise keeps a dead tunnel URL)
- hashed /assets/*: long-cache immutable
- missing .js/.css/.map: real 404 (never SPA-fallback HTML as JS)
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path

STATIC = Path(os.path.expanduser("~/poker_room_static"))
ASSET_EXTS = {".js", ".css", ".map", ".woff", ".woff2", ".ttf", ".png", ".jpg", ".svg", ".webp", ".ico"}


def application(environ, start_response):
    path = environ.get("PATH_INFO", "/") or "/"
    if path == "/":
        path = "/index.html"

    rel = path.lstrip("/")
    file_path = STATIC / rel
    suffix = Path(rel).suffix.lower()

    if not file_path.is_file():
        # Never serve index.html for missing hashed assets — breaks phone caches.
        if suffix in ASSET_EXTS or rel.startswith("assets/"):
            body = b"Not Found"
            start_response(
                "404 Not Found",
                [
                    ("Content-Type", "text/plain"),
                    ("Content-Length", str(len(body))),
                    ("Cache-Control", "no-store"),
                ],
            )
            return [body]
        file_path = STATIC / "index.html"

    if not file_path.is_file():
        start_response("404 Not Found", [("Content-Type", "text/plain")])
        return [b"Mini App not built. Run deploy/pa_point_web_at_tunnel.sh"]

    data = file_path.read_bytes()
    ctype, _ = mimetypes.guess_type(str(file_path))
    name = file_path.name
    is_index = name == "index.html"
    is_hashed_asset = file_path.parent.name == "assets"

    if is_index:
        cache = "no-store, no-cache, must-revalidate, max-age=0"
    elif is_hashed_asset:
        cache = "public, max-age=31536000, immutable"
    else:
        cache = "no-cache"

    headers = [
        ("Content-Type", ctype or "application/octet-stream"),
        ("Content-Length", str(len(data))),
        ("Cache-Control", cache),
        ("Pragma", "no-cache" if is_index else "public"),
    ]
    if is_index:
        headers.append(("Expires", "0"))

    start_response("200 OK", headers)
    return [data]
