#!/usr/bin/env bash
# Run on PythonAnywhere: bash /home/hedgehog22/poker_room/deploy/setup_pa.sh
set -euo pipefail
ROOT="${HOME}/poker_room"
cd "$ROOT"

echo "==> Node: $(node -v 2>/dev/null || echo MISSING)"
echo "==> npm:  $(npm -v 2>/dev/null || echo MISSING)"

if ! command -v node >/dev/null; then
  echo "ERROR: Node.js not found. Install via nvm or PA system image."
  exit 1
fi

echo "==> npm install"
npm install --omit=dev=false

echo "==> build shared + engine + web + api"
npm run build -w @poker/shared
npm run build -w @poker/poker-engine
npm run build -w @poker/web
npm run build -w @poker/api

echo "==> prisma"
cd apps/api
npx prisma generate
npx prisma db push --accept-data-loss=false || npx prisma db push
cd "$ROOT"

ENV_API="$ROOT/apps/api/.env"
ENV_WEB="$ROOT/apps/web/.env.production"
if [[ ! -f "$ENV_API" ]]; then
  cp "$ROOT/deploy/pythonanywhere.env.example" "$ENV_API"
  echo "Created $ENV_API — fill TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_IDS, JWT_SECRET"
fi
if [[ ! -f "$ENV_WEB" ]]; then
  cat > "$ENV_WEB" <<'EOF'
VITE_API_URL=https://hedgehog22.eu.pythonanywhere.com
VITE_WS_URL=https://hedgehog22.eu.pythonanywhere.com
EOF
  echo "Created $ENV_WEB — rebuild web after changing URLs: npm run build -w @poker/web"
fi

mkdir -p "$HOME/poker_room_static"
rm -rf "$HOME/poker_room_static"/*
cp -R "$ROOT/apps/web/dist/." "$HOME/poker_room_static/"
echo "==> Static Mini App copied to $HOME/poker_room_static"
echo "==> Done. Next: fill apps/api/.env, then start API (always-on):"
echo "    bash -lc 'export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\"; nvm use 20; cd $ROOT/apps/api && npx prisma generate && exec node dist/index.js'"
