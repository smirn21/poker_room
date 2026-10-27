#!/usr/bin/env bash
# Pull UI safe-area / Telegram chrome fixes from gist, rebuild static Mini App.
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm use 20 >/dev/null

ROOT="${HOME}/poker_room"
WEB="${ROOT}/apps/web"

curl -fsSL -o "${WEB}/src/telegram.ts" \
  "https://gist.githubusercontent.com/smirn21/04b5d588607981602ad30c0149d4751c/raw/telegram.ts"
curl -fsSL -o "${WEB}/src/App.tsx" \
  "https://gist.githubusercontent.com/smirn21/04b5d588607981602ad30c0149d4751c/raw/App.tsx"
curl -fsSL -o "${WEB}/src/styles.css" \
  "https://gist.githubusercontent.com/smirn21/04b5d588607981602ad30c0149d4751c/raw/styles.css"
curl -fsSL -o "${WEB}/index.html" \
  "https://gist.githubusercontent.com/smirn21/04b5d588607981602ad30c0149d4751c/raw/index.html"

# Keep VITE_* pointed at current tunnel if we have it
if [[ -f "${HOME}/poker_room_api_url.txt" ]]; then
  URL="$(tr -d '[:space:]' < "${HOME}/poker_room_api_url.txt")"
  if [[ -n "${URL}" ]]; then
    cat > "${WEB}/.env.production" <<EOF
VITE_API_URL=${URL}
VITE_WS_URL=${URL}
EOF
  fi
fi

cd "${ROOT}"
npm run build -w @poker/web

mkdir -p "${HOME}/poker_room_static"
rm -rf "${HOME}/poker_room_static"/*
cp -R "${WEB}/dist/." "${HOME}/poker_room_static/"

grep -q 'viewport-fit=cover' "${HOME}/poker_room_static/index.html"
grep -q 'safe-area-inset' "${HOME}/poker_room_static/assets/"*.css
echo "DONE_UI_SAFEAREA"
curl -sf "$(cat "${HOME}/poker_room_api_url.txt" 2>/dev/null || echo https://glen-boys-ferrari-outdoor.trycloudflare.com)/health" \
  && echo " HEALTH_OK" || echo " HEALTH_FAIL"
