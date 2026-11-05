#!/usr/bin/env bash
# After poker-api always-on is up, scrape trycloudflare URL and rebuild Mini App static.
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm use 20 >/dev/null

URL="${1:-}"
# Prefer explicit arg / saved URL, then newest match across always-on + tunnel logs.
if [[ -z "${URL}" && -f "${HOME}/poker_room_api_url.txt" ]]; then
  URL=$(tr -d '[:space:]' < "${HOME}/poker_room_api_url.txt" || true)
fi
if [[ -z "${URL}" ]]; then
  # PA always-on logs: /var/log/alwayson-log-*.log
  shopt -s nullglob
  for path in /var/log/alwayson-log-*.log "${HOME}/poker_room_tunnel.log" "${HOME}/poker_room_alwayson_console.log"; do
    [[ -f "${path}" ]] || continue
    cand=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "${path}" 2>/dev/null | tail -n 1 || true)
    if [[ -n "${cand}" ]]; then
      URL="${cand}"
    fi
  done
  shopt -u nullglob
fi

if [[ -z "${URL}" ]]; then
  echo "No trycloudflare URL found (pass URL arg or check always-on logs)" >&2
  exit 1
fi

echo "Tunnel URL: ${URL}"

ROOT="${HOME}/poker_room"
# Bot username for t.me deep links (table invites)
BOT_USER="Wpt_room_bot"
if [[ -f "${ROOT}/.env" ]]; then
  BOT_USER=$(grep -E '^TELEGRAM_BOT_USERNAME=' "${ROOT}/.env" | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/^@//')
  [[ -n "${BOT_USER}" ]] || BOT_USER="Wpt_room_bot"
fi
MINI_SHORT=""
if [[ -f "${ROOT}/.env" ]]; then
  MINI_SHORT=$(grep -E '^TELEGRAM_MINI_APP_SHORT_NAME=' "${ROOT}/.env" | head -1 | cut -d= -f2- | tr -d '\r' || true)
fi

# Vite loads .env.production.local over .env.production — write both.
for envf in "${ROOT}/apps/web/.env.production" "${ROOT}/apps/web/.env.production.local"; do
  {
    echo "VITE_API_URL=${URL}"
    echo "VITE_WS_URL=${URL}"
    echo "VITE_TG_BOT_USERNAME=${BOT_USER}"
    if [[ -n "${MINI_SHORT}" ]]; then
      echo "VITE_TG_MINI_APP_SHORT_NAME=${MINI_SHORT}"
    fi
  } > "${envf}"
done

# Keep API CORS on the Mini App origin + public API URL for TronHooks
if [[ -f "${ROOT}/.env" ]]; then
  if grep -q '^CORS_ORIGIN=' "${ROOT}/.env"; then
    sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://kiosk-hedgehog22.eu.pythonanywhere.com|' "${ROOT}/.env"
  else
    echo 'CORS_ORIGIN=https://kiosk-hedgehog22.eu.pythonanywhere.com' >> "${ROOT}/.env"
  fi
  if grep -q '^PUBLIC_API_URL=' "${ROOT}/.env"; then
    sed -i "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=${URL}|" "${ROOT}/.env"
  else
    echo "PUBLIC_API_URL=${URL}" >> "${ROOT}/.env"
  fi
fi
ln -sfn "${ROOT}/.env" "${ROOT}/apps/api/.env"

cd "${ROOT}"
npm run build -w @poker/web

mkdir -p "${HOME}/poker_room_static"
rm -rf "${HOME}/poker_room_static"/*
cp -R "${ROOT}/apps/web/dist/." "${HOME}/poker_room_static/"

echo "${URL}" > "${HOME}/poker_room_api_url.txt"
echo "DONE_POINT_WEB ${URL}"
curl -sf "${URL}/health" && echo " HEALTH_OK" || echo " HEALTH_FAIL"

# Keep TronHooks watch on the same public URL (payments break if webhook is stale).
if [[ -f "${ROOT}/deploy/verify_tronhooks.py" ]]; then
  python3 "${ROOT}/deploy/verify_tronhooks.py" \
    >>"${HOME}/poker_tronhooks_align.log" 2>&1 \
    && echo "TRONHOOKS_ALIGNED ${URL}" \
    || echo "TRONHOOKS_ALIGN_FAIL" >&2
fi
