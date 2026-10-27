#!/usr/bin/env bash
# After poker-api always-on is up, scrape trycloudflare URL and rebuild Mini App static.
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm use 20 >/dev/null

URL=""
# PA always-on logs: /var/log/alwayson-log-*.log
shopt -s nullglob
for path in /var/log/alwayson-log-*.log "${HOME}/poker_room_tunnel.log"; do
  [[ -f "${path}" ]] || continue
  cand=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "${path}" 2>/dev/null | tail -n 1 || true)
  if [[ -n "${cand}" ]]; then
    URL="${cand}"
  fi
done
shopt -u nullglob

if [[ -z "${URL}" ]]; then
  echo "No trycloudflare URL found in always-on logs yet" >&2
  exit 1
fi

echo "Tunnel URL: ${URL}"

ROOT="${HOME}/poker_room"
cat > "${ROOT}/apps/web/.env.production" <<EOF
VITE_API_URL=${URL}
VITE_WS_URL=${URL}
EOF

# Keep API CORS on the Mini App origin
if [[ -f "${ROOT}/.env" ]]; then
  if grep -q '^CORS_ORIGIN=' "${ROOT}/.env"; then
    sed -i 's|^CORS_ORIGIN=.*|CORS_ORIGIN=https://kiosk-hedgehog22.eu.pythonanywhere.com|' "${ROOT}/.env"
  else
    echo 'CORS_ORIGIN=https://kiosk-hedgehog22.eu.pythonanywhere.com' >> "${ROOT}/.env"
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
