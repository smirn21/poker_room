#!/usr/bin/env bash
# Always-on entry: Node API + Cloudflare quick tunnel (public HTTPS).
# Tunnel URL is printed to stdout/stderr (always-on log) as https://*.trycloudflare.com
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
# Don't block always-on forever if generate is flaky — client is usually already present.
npx prisma generate >/dev/null 2>&1 || echo "prisma_generate_skip" >&2
node dist/index.js >>"${HOME}/poker_api.log" 2>&1 &
API_PID=$!

cleanup() { kill "${API_PID}" 2>/dev/null || true; }
trap cleanup EXIT

# Wait for listen; do not abort if curl is flaky on this host — tunnel will
# retry origin. Exiting here caused crash loops while the API was already up.
ok=0
for _ in $(seq 1 90); do
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 0.5
done
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
        # Rebuild Mini App when tunnel URL changes (phone otherwise keeps dead VITE_*).
        if [[ "${NEW_URL}" != "${OLD_URL}" ]]; then
          echo "tunnel_url_changed — scheduling pa_point_web_at_tunnel.sh" >&2
          (
            sleep 3
            bash "${HOME}/poker_room/deploy/pa_point_web_at_tunnel.sh" \
              >>"${HOME}/poker_point_web.log" 2>&1 \
              || echo "point_web_failed" >&2
          ) &
        fi
      fi
    done
# If the pipe ends, exit so always-on restarts us.
exit 1
