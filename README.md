# Club Hold'em — private Telegram poker room

Invite-only Texas Hold'em Mini App for a closed circle: whitelist + invite codes, Telegram avatars, table chat, chip ledger with crypto deposit intents (admin confirm). Cards payments are out of MVP scope.

## Stack

- `apps/web` — React + Vite Telegram Mini App
- `apps/api` — Fastify + Socket.IO + Prisma (SQLite)
- `packages/poker-engine` — Hold'em state machine + hand evaluator
- `packages/shared` — shared types

Decisions & architecture: [docs/DECISIONS.md](docs/DECISIONS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

```bash
npm install
npm run build -w @poker/shared
npm run build -w @poker/poker-engine
npm run db:generate -w @poker/api
npm run db:push -w @poker/api
npm run db:seed -w @poker/api
```

Run API and web (two terminals):

```bash
npm run dev:api
npm run dev:web
```

Open http://localhost:5173 — default user is admin (`dev:1`).  
Second player: http://localhost:5173/?dev=2 — redeem the invite code printed by seed.

## Telegram

1. Create a bot via BotFather, set `TELEGRAM_BOT_TOKEN`.
2. Set Mini App URL to your HTTPS frontend.
3. Set `DEV_BYPASS_AUTH=0` and `ADMIN_TELEGRAM_IDS` to your Telegram user id(s).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run test` | Engine unit tests |
| `npm run db:seed` | Admin user + invite code |
