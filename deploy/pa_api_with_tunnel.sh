#!/usr/bin/env bash
# Always-on entry: Node API + Cloudflare quick tunnel (public HTTPS).
# Tunnel URL is printed to stdout/stderr (always-on log) as https://*.trycloudflare.com
#
# Operator flow after PA reboot / unpaid pause:
#   1) Tasks → Restart always-on "poker-api" (this script self-heals npm/prisma)
#   2) Web → Reload kiosk webapp (only if static was rebuilt / PA static cache)
# No manual npm install needed — pa_ensure_deps.sh runs on every start.
#
# If Node dies while cloudflared stays up, we exit so PA always-on restarts us
# (previously tunnel kept running → Mini App saw 502 forever).
#
# PA NFS: rsync can rewrite this file while always-on is mid-run → bash
# "Stale file handle". Re-exec from a /tmp copy so deploys don't kill us.
if [[ "${POKER_API_SCRIPT_COPIED:-}" != "1" ]]; then
  _src="${BASH_SOURCE[0]:-$0}"
  _dst="${HOME}/poker_api_with_tunnel.runtime.sh"
  cp -f "${_src}" "${_dst}" 2>/dev/null || cp -f "${_src}" "/tmp/poker_api_with_tunnel.runtime.sh"
  [[ -f "${_dst}" ]] || _dst="/tmp/poker_api_with_tunnel.runtime.sh"
  chmod +x "${_dst}" 2>/dev/null || true
  export POKER_API_SCRIPT_COPIED=1
  exec bash "${_dst}" "$@"
fi

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

CF_PID=""
cleanup() {
  kill "${API_PID}" 2>/dev/null || true
  [[ -n "${CF_PID}" ]] && kill "${CF_PID}" 2>/dev/null || true
}
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

TUNNEL_LOG="${HOME}/poker_room_tunnel.log"
URL_FILE="${HOME}/poker_room_api_url.txt"
: > "${TUNNEL_LOG}"

# Run tunnel in background; scrape URL from its log.
stdbuf -oL -eL "${CF}" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" \
  >>"${TUNNEL_LOG}" 2>&1 &
CF_PID=$!

schedule_point_web() {
  local url="$1"
  # nohup: must survive this always-on process exiting (otherwise
  # Mini App keeps the old trycloudflare URL → «нет связи» for hours).
  echo "tunnel_url_changed — scheduling point_web + tronhooks align (${url})" >&2
  nohup bash -c "
    sleep 2
    flock -n \"\$HOME/poker_point_web.lock\" \
      bash \"\$HOME/poker_room/deploy/pa_point_web_at_tunnel.sh\" \"${url}\" \
      >>\"\$HOME/poker_point_web.log\" 2>&1 \
      || echo point_web_failed >>\"\$HOME/poker_point_web.log\"
  " >/dev/null 2>&1 &
}
# So the scrape subshell can call it.
export -f schedule_point_web

# Scrape trycloudflare URL and rebind Mini App / TronHooks when it changes.
(
  seen=""
  while true; do
    if [[ -f "${TUNNEL_LOG}" ]]; then
      cand=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" 2>/dev/null | tail -n 1 || true)
      if [[ -n "${cand}" && "${cand}" != "${seen}" ]]; then
        OLD_URL=""
        [[ -f "${URL_FILE}" ]] && OLD_URL="$(tr -d '[:space:]' < "${URL_FILE}" || true)"
        echo "${cand}" > "${URL_FILE}"
        echo "TUNNEL_URL ${cand}" >&2
        seen="${cand}"
        if [[ "${cand}" != "${OLD_URL}" ]]; then
          schedule_point_web "${cand}"
        fi
      fi
    fi
    sleep 2
  done
) &
SCRAPE_PID=$!

# Watchdog: if API dies (or cloudflared dies), exit so PA restarts the whole task.
fail_streak=0
watch_loops=0
while true; do
  sleep 20
  watch_loops=$((watch_loops + 1))
  if ! kill -0 "${CF_PID}" 2>/dev/null; then
    echo "cloudflared exited — restarting always-on" >&2
    kill "${SCRAPE_PID}" 2>/dev/null || true
    exit 1
  fi
  if curl -sf --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null; then
    fail_streak=0
    # Quick tunnel can go zombie (process up, public 530) while Node is fine.
    # Every ~2 min probe the public URL; exit so always-on refreshes the tunnel.
    if (( watch_loops % 6 == 0 )); then
      LIVE="$(tr -d '[:space:]' < "${URL_FILE}" 2>/dev/null || true)"
      if [[ -n "${LIVE}" ]] && ! curl -sf --max-time 8 "${LIVE}/health" >/dev/null; then
        echo "public_tunnel_dead LIVE=${LIVE} — exiting for always-on restart" >&2
        kill "${SCRAPE_PID}" 2>/dev/null || true
        exit 1
      fi
      STATIC_URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' \
        "${HOME}/poker_room_static/assets/"*.js 2>/dev/null | sort -u | tail -n 1 || true)"
      if [[ -n "${LIVE}" && -n "${STATIC_URL}" && "${LIVE}" != "${STATIC_URL}" ]]; then
        echo "static_stale LIVE=${LIVE} STATIC=${STATIC_URL} — re-pointing web" >&2
        schedule_point_web "${LIVE}"
      fi
    fi
    continue
  fi
  fail_streak=$((fail_streak + 1))
  echo "API health fail streak=${fail_streak}" >&2
  if [[ "${fail_streak}" -ge 2 ]]; then
    echo "API dead while tunnel up — exiting so always-on restarts" >&2
    tail -n 40 "${HOME}/poker_api.log" >&2 || true
    kill "${SCRAPE_PID}" 2>/dev/null || true
    exit 1
  fi
  # Soft restart: heal prisma/deps first (Bus error / PA wipe often leave
  # @prisma/client uninitialized — bare node restart then fails forever).
  echo "restarting Node API once (with ensure_deps)" >&2
  kill "${API_PID}" 2>/dev/null || true
  sleep 1
  bash "${HOME}/poker_room/deploy/pa_ensure_deps.sh" || true
  cd "${HOME}/poker_room/apps/api"
  start_api
done
