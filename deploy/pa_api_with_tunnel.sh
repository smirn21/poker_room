#!/usr/bin/env bash
# Always-on entry: Node API + Cloudflare quick tunnel (public HTTPS).
# Tunnel URL is printed to stdout/stderr (always-on log) as https://*.trycloudflare.com
#
# Operator flow after PA reboot / unpaid pause:
#   1) Tasks → Restart always-on "poker-api" (this script self-heals npm/prisma)
#   2) Web → Reload kiosk webapp (only if static was rebuilt / PA static cache)
# No manual npm install needed — pa_ensure_deps.sh runs on every start.
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm use 20 >/dev/null

CF="${HOME}/bin/cloudflared"
mkdir -p "${HOME}/bin"
if [[ ! -x "${CF}" ]]; then
  curl -fsSL -o "${CF}.tmp" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  chmod +x "${CF}.tmp"
  mv "${CF}.tmp" "${CF}"
fi

# Restore wiped node_modules / prisma after PA account freeze.
bash "${HOME}/poker_room/deploy/pa_ensure_deps.sh"

cd "${HOME}/poker_room/apps/api"
# Ensure Mini App ?dev=1 auth works even if .env load order is flaky.
export DEV_BYPASS_AUTH="${DEV_BYPASS_AUTH:-1}"
if [[ -f "${HOME}/poker_room/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${HOME}/poker_room/.env"
  set +a
fi
export DEV_BYPASS_AUTH=1
export PORT=18765

start_api() {
  node dist/index.js >>"${HOME}/poker_api.log" 2>&1 &
  API_PID=$!
}

start_api

cleanup() { kill "${API_PID}" 2>/dev/null || true; }
trap cleanup EXIT

# Wait for listen. If deps were still broken, force-reinstall once and retry.
ok=0
for _ in $(seq 1 40); do
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 0.5
done
if [[ "${ok}" -ne 1 ]]; then
  echo "API not healthy — FORCE_NPM_INSTALL=1 and retry once" >&2
  tail -n 30 "${HOME}/poker_api.log" >&2 || true
  kill "${API_PID}" 2>/dev/null || true
  FORCE_NPM_INSTALL=1 bash "${HOME}/poker_room/deploy/pa_ensure_deps.sh"
  cd "${HOME}/poker_room/apps/api"
  start_api
  trap cleanup EXIT
  ok=0
  for _ in $(seq 1 90); do
    if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null; then
      ok=1
      break
    fi
    sleep 0.5
  done
fi
if [[ "${ok}" -eq 1 ]]; then
  echo "API healthy on :${PORT} — starting cloudflared tunnel" >&2
else
  echo "API health curl timed out on :${PORT}; starting tunnel anyway" >&2
  tail -n 20 "${HOME}/poker_api.log" >&2 || true
  sleep 2
fi

# Tee cloudflared output so we can scrape the trycloudflare URL reliably.
# Always-on stays alive while this pipeline runs.
TUNNEL_LOG="${HOME}/poker_room_tunnel.log"
URL_FILE="${HOME}/poker_room_api_url.txt"
: > "${TUNNEL_LOG}"

stdbuf -oL -eL "${CF}" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" 2>&1 \
  | tee -a "${TUNNEL_LOG}" \
  | while IFS= read -r line; do
      echo "${line}"
      if [[ "${line}" =~ https://[a-zA-Z0-9-]+\.trycloudflare\.com ]]; then
        NEW_URL="${BASH_REMATCH[0]}"
        OLD_URL=""
        [[ -f "${URL_FILE}" ]] && OLD_URL="$(cat "${URL_FILE}" 2>/dev/null || true)"
        echo "${NEW_URL}" > "${URL_FILE}"
        echo "TUNNEL_URL ${NEW_URL}" >&2
        # Rebuild Mini App + rebind TronHooks when tunnel URL changes.
        if [[ "${NEW_URL}" != "${OLD_URL}" ]]; then
          echo "tunnel_url_changed — scheduling point_web + tronhooks align" >&2
          (
            sleep 3
            bash "${HOME}/poker_room/deploy/pa_point_web_at_tunnel.sh" \
              >>"${HOME}/poker_point_web.log" 2>&1 \
              || echo "point_web_failed" >&2
            # API watchdog also realigns; this covers the gap before the next tick.
            python3 "${HOME}/poker_room/deploy/verify_tronhooks.py" \
              >>"${HOME}/poker_tronhooks_align.log" 2>&1 \
              || echo "tronhooks_align_failed" >&2
          ) &
        fi
      fi
    done
# If the pipe ends, exit so always-on restarts us.
exit 1
