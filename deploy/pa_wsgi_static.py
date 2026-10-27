"""
PythonAnywhere WSGI entry: serve Vite build + reverse-proxy API is NOT here.
Static Mini App only. Point Web app to this file OR map Static files to ~/poker_room_static.
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path

STATIC = Path(os.path.expanduser("~/poker_room_static"))


def application(environ, start_response):
    path = environ.get("PATH_INFO", "/") or "/"
    if path == "/":
        path = "/index.html"
    # SPA fallback
    file_path = STATIC / path.lstrip("/")
    if not file_path.is_file():
        file_path = STATIC / "index.html"
    if not file_path.is_file():
        start_response("404 Not Found", [("Content-Type", "text/plain")])
        return [b"Mini App not built. Run deploy/setup_pa.sh"]
    data = file_path.read_bytes()
    ctype, _ = mimetypes.guess_type(str(file_path))
    start_response(
        "200 OK",
        [
            ("Content-Type", ctype or "application/octet-stream"),
            ("Content-Length", str(len(data))),
            ("Cache-Control", "no-cache"),
        ],
    )
    return [data]
