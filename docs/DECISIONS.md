# Locked decisions (MVP)

## Money model
- **Club chip ledger** (internal balance), not open public gambling.
- Deposits: **crypto-first** (USDT / TON) via payment intent + admin or provider webhook confirmation.
- Withdrawals: admin-approved for MVP (trust circle).
- **Cards: phase 2** (not in MVP).
- Starting bonus: configurable `SIGNUP_BONUS_CHIPS` (default 10_000) for invite-accepted users so tables work before first deposit.

## Access model
- **Invite-only**: one-time / limited invite codes issued by admins.
- On accept: `telegram_id` added to **whitelist**; Mini App rejects everyone else.
- Auth: validate Telegram WebApp `initData` HMAC on every session.
- Optional later: Telegram group membership check.

## Why these defaults
Plan option **B (club product)**: closed circle, ledger, crypto path, no card rails until legal/ops are clear.
