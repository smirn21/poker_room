#!/usr/bin/env bash
# Deploy auth 401 fix + enable DEV_BYPASS_AUTH for Mini App ?dev= probes.
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm use 20 >/dev/null

ROOT="${HOME}/poker_room"
API="${ROOT}/apps/api"

curl -fsSL -o "${API}/src/routes.ts" "https://gist.githubusercontent.com/smirn21/04b5d588607981602ad30c0149d4751c/raw/0e1b8127e9d5fd46ee583dd8ded508edb983ad6b/routes.ts"
curl -fsSL -o "${API}/src/index.ts" "https://gist.githubusercontent.com/smirn21/04b5d588607981602ad30c0149d4751c/raw/cdbb6ddc47bc8f831f40ea9bf6567020ebd1bd5a/index.ts"

ENV_FILE="${ROOT}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  if grep -q '^DEV_BYPASS_AUTH=' "${ENV_FILE}"; then
    sed -i 's/^DEV_BYPASS_AUTH=.*/DEV_BYPASS_AUTH=1/' "${ENV_FILE}"
  else
    echo 'DEV_BYPASS_AUTH=1' >> "${ENV_FILE}"
  fi
else
  echo 'DEV_BYPASS_AUTH=1' > "${ENV_FILE}"
fi
ln -sfn "${ENV_FILE}" "${API}/.env"

cd "${ROOT}"
npm run build -w @poker/api

pkill -f 'cloudflared tunnel' 2>/dev/null || true
pkill -f 'node dist/index.js' 2>/dev/null || true

echo "DONE_AUTH_DEVBYPASS — waiting for always-on restart…"
sleep 30

URL=""
for _ in $(seq 1 50); do
  if [[ -f "${HOME}/poker_room_api_url.txt" ]]; then
    URL="$(tr -d '[:space:]' < "${HOME}/poker_room_api_url.txt")"
  fi
  CAND="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "${HOME}/poker_room_tunnel.log" 2>/dev/null | tail -1 || true)"
  if [[ -n "${CAND}" ]]; then
    echo "${CAND}" > "${HOME}/poker_room_api_url.txt"
    URL="${CAND}"
  fi
  if [[ -n "${URL}" ]] && curl -sf "${URL}/health" >/dev/null; then
    break
  fi
  sleep 3
done

if [[ -z "${URL}" ]] || ! curl -sf "${URL}/health" >/dev/null; then
  echo "HEALTH_FAIL after restart" >&2
  exit 1
fi
echo "HEALTH_OK ${URL}"

bash "${ROOT}/deploy/pa_point_web_at_tunnel.sh"

CODE="$(curl -sS -o /tmp/auth_probe.json -w '%{http_code}' -X POST "${URL}/auth/telegram" \
  -H 'content-type: application/json' \
  -d '{"initData":"dev:1:Admin"}')"
echo "AUTH_PROBE ${CODE} $(head -c 160 /tmp/auth_probe.json)"
test "${CODE}" = "200"
echo "DONE_AUTH_OK"
