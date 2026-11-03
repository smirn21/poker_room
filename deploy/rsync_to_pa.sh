#!/usr/bin/env bash
# Sync repo → PythonAnywhere home. Never delete SQLite / env / static.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${PA_SSH_HOST:-pa}"
REMOTE="${PA_REMOTE_DIR:-~/poker_room}"

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude 'apps/web/dist' \
  --exclude '*.tsbuildinfo' \
  --exclude .env \
  --exclude 'apps/api/.env' \
  --exclude 'apps/web/.env*' \
  --exclude '*.db' \
  --exclude '*.db-*' \
  --exclude 'apps/api/prisma/*.db' \
  --exclude 'apps/api/prisma/*.db-*' \
  --exclude .taste-skill \
  "${ROOT}/" "${HOST}:${REMOTE}/"

echo "DONE_RSYNC ${HOST}:${REMOTE}"
