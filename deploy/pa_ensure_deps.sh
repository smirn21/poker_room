#!/usr/bin/env bash
# Idempotent: restore Node deps / Prisma / API build after PA wipe / unpaid pause.
# Used by always-on (pa_api_with_tunnel) and Mini App rebuild (pa_point_web_at_tunnel).
set -euo pipefail

ROOT="${HOME}/poker_room"
export NVM_DIR="${HOME}/.nvm"
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm use 20 >/dev/null

cd "${ROOT}"

need_install=0
if [[ "${FORCE_NPM_INSTALL:-0}" == "1" ]]; then
  need_install=1
fi
# Workspace hoists packages to repo root node_modules.
[[ -d "${ROOT}/node_modules/fastify" ]] || need_install=1
[[ -d "${ROOT}/node_modules/@types/react" ]] || need_install=1
[[ -d "${ROOT}/node_modules/vite" ]] || need_install=1
[[ -d "${ROOT}/node_modules/@prisma/client" ]] || need_install=1

if [[ "${need_install}" -eq 1 ]]; then
  echo "pa_ensure_deps: npm install (missing packages or FORCE_NPM_INSTALL=1)" >&2
  npm install
else
  echo "pa_ensure_deps: node_modules ok" >&2
fi

# Prisma client (API imports @prisma/client).
echo "pa_ensure_deps: prisma generate" >&2
(
  cd "${ROOT}/apps/api"
  npx prisma generate >/dev/null
) || echo "pa_ensure_deps: prisma_generate_failed" >&2

if [[ ! -f "${ROOT}/apps/api/dist/index.js" ]]; then
  echo "pa_ensure_deps: building @poker/api (dist missing)" >&2
  npm run build -w @poker/shared >/dev/null 2>&1 || true
  npm run build -w @poker/poker-engine >/dev/null 2>&1 || true
  npm run build -w @poker/api
fi

echo "pa_ensure_deps: ready" >&2
