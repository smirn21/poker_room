# Agent ops — Club Hold'em / PythonAnywhere

Always apply. After **any** code change, config change, or deploy, run a **full verification** yourself before telling the user it’s done. Do not ask the user to “check if it works.”

## Git: commit + push

После любой своей работы (код, конфиг, деплой-скрипты, правила, доки):

1. Сделай **git commit** с сообщением **на русском языке** (кратко: зачем, не «что построчно»).
2. Сразу сделай **git push** в текущую ветку (обычно `main` / tracking remote).
3. Не оставляй незакоммиченные правки «на потом», если задача завершена или её часть уже готова к сохранению.
4. Секреты (`.env`, токены, ключи) в коммит **не** клади.

## Если после правок что-то сломалось

- Не оставляй в сломанном состоянии: **исправь** до зелёной проверки по чеклисту ниже.
- Если фикс не выходит быстро или правка оказалась вредной — **откати / удали** сломанное изменение (revert файлов, убери фичу, верни рабочий деплой), снова проверь, закоммить и запушь.
- Сообщать «не работает, проверь сам» нельзя — либо починил, либо убрал.

## Full verification checklist

1. **API health** — public HTTPS `/health` returns `{"ok":true}` (tunnel or current public URL in `~/poker_room_api_url.txt` / always-on log).
2. **Mini App static** — `https://kiosk-hedgehog22.eu.pythonanywhere.com/` serves the built app (200, expected assets).
3. **Auth/boot** — open Mini App with `?dev=1` (or Telegram); lobby/invite loads without Internal Server Error.
4. **Realtime** — if table/WS touched: Socket.IO connects against the same public URL as `VITE_WS_URL`.
5. **UI smoke** — screenshot or browser snapshot; content clears Telegram chrome + iPhone notch/home indicator (safe-area).

If any step fails, fix it (restart always-on, re-run `deploy/pa_point_web_at_tunnel.sh`, rebuild, etc.) or remove the breaking change, then re-run the checklist. Then commit (RU) + push.

## Tools you may use

- **Subagents** for parallel investigate/fix/verify.
- **Computer Use** on the logged-in PythonAnywhere Chrome session (Tasks, Files, always-on logs, Web).
- **IDE browser** for Mini App / health checks.
- Shell/`curl` for `/health` and static HEAD/GET.

## Deploy notes (PA)

- Node API is **always-on** via `bash ~/poker_room/deploy/pa_api_with_tunnel.sh` (cloudflared quick tunnel).
- Quick tunnel URL **changes on restart** → must rebuild web: `bash ~/poker_room/deploy/pa_point_web_at_tunnel.sh`.
- Static Mini App root: `~/poker_room_static` → webapp `kiosk-hedgehog22.eu.pythonanywhere.com`.
- CORS must allow that Mini App origin.

## Telegram Mini App layout

- Use `viewport-fit=cover` and padding from `safe-area-inset-*` + Telegram `contentSafeAreaInset` / CSS vars (`--tg-content-safe-area-inset-*`).
- Keep content clear of TG close, back, ⋯ menu, and minimize controls, and of notch / home indicator.
