# Agent ops — Hold'em House / PythonAnywhere

Always apply. After **any** code change, config change, or deploy, run a **full verification** yourself before telling the user it’s done. Do not ask the user to “check if it works.”

## Git: commit + push

После любой своей работы (код, конфиг, деплой-скрипты, правила, доки):

1. Сделай **git commit** с сообщением **на русском языке** (кратко: зачем, не «что построчно»).
2. Сразу сделай **git push** в текущую ветку (обычно `main` / tracking remote).
3. Не оставляй незакоммиченные правки «на потом», если задача завершена или её часть уже готова к сохранению.
4. Секреты (`.env`, токены, ключи) в коммит **не** клади.
5. В конце проверь **`git status`**: рабочее дерево должно быть **чистым**. Мусор (сборки, `.tsbuildinfo`, `.b64`, локальные `.env*`, эксперименты вроде `.taste-skill/`) — в `.gitignore` или удали; не оставляй висящие untracked/unstaged после «готово».

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

## PythonAnywhere: SSH first, browser second

**Верно:** почти всё на PA делается через SSH (`ssh pa` / BatchMode) — быстрее и точнее, чем кликать в дашборде.

Делай по SSH (по умолчанию):

- чтение/правка файлов, `git pull` / `reset --hard`, `scp`, `chmod`
- логи: `~/poker_api.log`, `~/poker_room_tunnel.log`, `~/poker_point_web.log`, `/var/log/alwayson-log-*.log`
- URL туннеля: `cat ~/poker_room_api_url.txt`
- деплой: `bash ~/poker_room/deploy/pa_ensure_deps.sh`, `pa_point_web_at_tunnel.sh`, `verify_tronhooks.py`
- проверки: `curl` к **публичному** tunnel URL (`/health`, auth) и к static Mini App

Нюанс: always-on крутится на **другом** хосте, чем SSH-консоль. `curl http://127.0.0.1:18765` с SSH обычно **не** видит API — это нормально. Смотри публичный URL и always-on log.

Браузер / Computer Use — **только если SSH не хватает**:

1. Tasks → Create / Restart / Disable always-on `poker-api` (нет SSH API у PA для этого)
2. Web → Reload kiosk webapp, если статика залипла
3. UI smoke Mini App (`?dev=1`) — IDE browser / скрин

Не открывай PA Chrome «на всякий случай», пока не упёрся в пункт из списка выше.

## Tools you may use

- **SSH + shell/`curl`** — основной путь к PA (см. выше).
- **Subagents** for parallel investigate/fix/verify.
- **Computer Use** on the logged-in PythonAnywhere Chrome session — только Tasks/Web UI, когда SSH недостаточен.
- **IDE browser** for Mini App / public health UI smoke.

## Deploy notes (PA)

- Node API is **always-on** via `bash ~/poker_room/deploy/pa_api_with_tunnel.sh` (cloudflared quick tunnel).
- On start, that script runs `pa_ensure_deps.sh` (npm/prisma/self-heal after unpaid wipe) then opens the tunnel.
- Quick tunnel URL **changes on restart** → always-on auto-runs `pa_point_web_at_tunnel.sh` (also calls `pa_ensure_deps.sh`).
- Static Mini App root: `~/poker_room_static` → webapp `kiosk-hedgehog22.eu.pythonanywhere.com`.
- CORS must allow that Mini App origin.

### Restart after PA reboot / billing (normal ops)

1. **Tasks** → always-on `poker-api` → **Restart** (deps + API + tunnel + web rebuild if URL changed).
2. **Web** → Reload the kiosk webapp (only if the static site looks stale).
3. Do **not** hand-run `npm install` unless Restart still fails — check always-on log first.

### Why Mini App says «нет связи» after a few days

Typical chain on PA:

1. Node hits **Bus error** (PA host / memory) after long uptime.
2. Soft restart used to skip `prisma generate` → API stays dead.
3. Watchdog exits → always-on starts a **new quick tunnel URL**.
4. If `pa_point_web_at_tunnel.sh` dies with the old process, static Mini App still embeds the **old** `VITE_WS_URL` → clients cannot reach the live API.

Mitigations in `pa_api_with_tunnel.sh`: soft restart runs `pa_ensure_deps.sh`; point_web is `nohup`+`flock` so it survives restarts; watchdog re-points static if URL drifts.

## Telegram Mini App layout

- Use `viewport-fit=cover` and padding from `safe-area-inset-*` + Telegram `contentSafeAreaInset` / CSS vars (`--tg-content-safe-area-inset-*`).
- Keep content clear of TG close, back, ⋯ menu, and minimize controls, and of notch / home indicator.
