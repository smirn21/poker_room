#!/usr/bin/env python3
"""Verify TronHooks watch + signed webhook against live PA tunnel."""
from __future__ import annotations

import hashlib
import hmac
import json
import ssl
import uuid
import urllib.error
import urllib.request
from pathlib import Path

home = Path.home()
env_path = home / "poker_room" / ".env"
ctx = ssl.create_default_context()


def load_env(path: Path) -> dict[str, str]:
    vals: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            vals[k] = v.strip().strip('"').strip("'")
    return vals


def write_env_key(path: Path, key: str, value: str) -> None:
    lines = path.read_text().splitlines()
    out: list[str] = []
    found = False
    for line in lines:
        if line.startswith(key + "="):
            out.append(f"{key}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{key}={value}")
    path.write_text("\n".join(out) + "\n")


def api(key: str, method: str, url: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        raw = resp.read().decode()
        return resp.status, (json.loads(raw) if raw else {})


def main() -> int:
    vals = load_env(env_path)
    live = (home / "poker_room_api_url.txt").read_text().strip().rstrip("/")
    webhook = f"{live}/webhooks/tronhooks"
    key = vals["TRONHOOKS_API_KEY"]
    addr = vals["TRON_USDT_ADDRESS"]
    secret = vals.get("TRONHOOKS_WEBHOOK_SECRET", "")

    print("LIVE", live)

    h = json.load(urllib.request.urlopen(live + "/health", timeout=15, context=ctx))
    th = h.get("tronhooks", {})
    print("HEALTH_OK", h.get("ok"))
    print("TH_enabled", th.get("enabled"), "hasSecret", th.get("hasSecret"))
    print("TH_webhook", th.get("webhookUrl"))
    print("TH_matches_live", th.get("webhookUrl") == webhook)

    write_env_key(env_path, "PUBLIC_API_URL", live)

    _st, data = api(key, "GET", "https://tronhooks.com/v1/watches")
    watches = data.get("data") or []
    need = True
    for w in watches:
        print("EXISTING", w.get("status"), w.get("webhook_url"))
        if w.get("webhook_url") == webhook and w.get("address") == addr:
            need = False
            print("WATCH_ALREADY_OK")

    if need:
        for w in watches:
            try:
                api(key, "DELETE", f"https://tronhooks.com/v1/watches/{w['id']}")
                print("DELETED", w["id"])
            except Exception as e:
                print("DEL_ERR", e)
        _st, created = api(
            key,
            "POST",
            "https://tronhooks.com/v1/watches",
            {
                "address": addr,
                "asset_filter": "USDT",
                "direction": "incoming",
                "webhook_url": webhook,
            },
        )
        print("CREATED", created.get("webhook_url"))
        new_secret = created.get("secret")
        if new_secret:
            secret = new_secret
            write_env_key(env_path, "TRONHOOKS_WEBHOOK_SECRET", secret)
            print("SECRET_UPDATED_NEED_RESTART")
        else:
            print("NO_NEW_SECRET")
    else:
        print("ENV_PUBLIC_SYNCED")

    vals = load_env(env_path)
    secret = vals["TRONHOOKS_WEBHOOK_SECRET"]

    event = {
        "api_version": "2026-08",
        "event_id": "verify-" + uuid.uuid4().hex,
        "type": "transfer.confirmed",
        "direction": "incoming",
        "network": "mainnet",
        "asset": "USDT",
        "contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        "tx_id": "verifytx" + uuid.uuid4().hex[:48],
        "event_index": 0,
        "block_number": 1,
        "block_timestamp": "2026-10-29T15:00:00.000Z",
        "from": "TFromVerifyAddressxxxxxxxxxxxx1111",
        "to": addr,
        "amount_raw": "1234567",
        "amount": "1.234567",
        "watch_id": "verify-watch",
    }
    raw = json.dumps(event, separators=(",", ":")).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        webhook,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json", "X-Signature": sig},
    )
    try:
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
            body = resp.read().decode()
            print("WEBHOOK_STATUS", resp.status, body)
    except urllib.error.HTTPError as e:
        print("WEBHOOK_FAIL", e.code, e.read().decode()[:400])
        return 1
    except Exception as e:
        print("WEBHOOK_FAIL", e)
        return 1

    # bad signature should 401
    bad = urllib.request.Request(
        webhook,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json", "X-Signature": "0" * 64},
    )
    try:
        urllib.request.urlopen(bad, timeout=15, context=ctx)
        print("BAD_SIG_UNEXPECTED_OK")
        return 1
    except urllib.error.HTTPError as e:
        print("BAD_SIG_STATUS", e.code)

    # Final good delivery clears lastError left by the intentional bad-sig probe.
    event2 = dict(event)
    event2["event_id"] = "verify-" + uuid.uuid4().hex
    event2["tx_id"] = "verifytx" + uuid.uuid4().hex[:48]
    raw2 = json.dumps(event2, separators=(",", ":")).encode()
    sig2 = hmac.new(secret.encode(), raw2, hashlib.sha256).hexdigest()
    good2 = urllib.request.Request(
        webhook,
        data=raw2,
        method="POST",
        headers={"Content-Type": "application/json", "X-Signature": sig2},
    )
    with urllib.request.urlopen(good2, timeout=20, context=ctx) as resp:
        print("WEBHOOK_STATUS2", resp.status, resp.read().decode()[:200])

    h2 = json.load(urllib.request.urlopen(live + "/health", timeout=15, context=ctx))
    th2 = h2.get("tronhooks", {})
    print(
        "AFTER",
        "event",
        th2.get("lastEventAt"),
        "result",
        th2.get("lastResult"),
        "err",
        th2.get("lastError"),
    )

    # mini app static
    static = urllib.request.urlopen(
        "https://kiosk-hedgehog22.eu.pythonanywhere.com/",
        timeout=15,
        context=ctx,
    )
    html = static.read().decode("utf-8", "ignore")
    print(
        "STATIC_STATUS",
        static.status,
        "has_root",
        '<div id="root">' in html,
    )

    ok = (
        h.get("ok")
        and th.get("enabled")
        and th.get("hasSecret")
        and th.get("webhookUrl") == webhook
        and th2.get("lastResult") in ("unmatched", "matched", "duplicate_event")
    )
    print("OVERALL", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
