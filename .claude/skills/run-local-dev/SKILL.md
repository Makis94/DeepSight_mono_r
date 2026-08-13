---
name: run-local-dev
description: Use this skill whenever the user asks to start/run/launch the project locally, bring up docker, start dev servers, or get an ngrok link for Telegram bot auth (Login Widget domain / BotFather). Trigger phrases include "запусти проект", "подними проект", "docker запустил, запусти проект", "дай ссылку на ngrok", "start the dev environment", "run the app locally". This skill encodes the exact working sequence (ports, env checks, which service ngrok must point at) so it can be repeated across sessions without rediscovering it by trial and error.
---

# Running HyperTracker locally + Telegram auth tunnel

## Ground rules

- This is local, reversible dev tooling (docker containers, dev servers, an ngrok tunnel). Do not stop to ask for confirmation before running the bootstrap sequence itself — just do it, unless a required `.env` file is missing (see below), in which case stop and ask instead of inventing values.
- Never fabricate secrets. `apps/{api,bot,worker,web}/.env` are expected to already exist locally (gitignored). If any is missing, tell the user which one and what keys it needs (see `.env.example` in that app) instead of guessing values — this is a hard stop, not a "continue with placeholder" situation.

## Ports (fixed, don't rediscover)

- Postgres: `5432` (docker compose service `postgres`, container name `hypertracker-postgres-1`)
- `apps/api`: `3001`
- `apps/web` (vite): `5173`
- `apps/bot`, `apps/worker`: no exposed HTTP port (worker exposes heartbeat ports 910x internally, not relevant here)

## Boot sequence

1. **Postgres**

   ```bash
   docker compose up -d postgres
   until [ "$(docker inspect -f '{{.State.Health.Status}}' hypertracker-postgres-1 2>/dev/null)" = "healthy" ]; do sleep 1; done
   ```

2. **Migrations** (idempotent — safe to re-run every session)

   ```bash
   DATABASE_URL="postgres://hypertracker:hypertracker@localhost:5432/hypertracker" pnpm --filter @hypertracker/db db:migrate
   ```

3. **App dev servers** — all four together, backgrounded (this is a long-running process, always use `run_in_background`):

   ```bash
   pnpm turbo run dev --filter=@hypertracker/api --filter=@hypertracker/web --filter=@hypertracker/bot --filter=@hypertracker/worker
   ```

   Confirm readiness with a poll loop instead of a fixed sleep, e.g. `until curl -s -o /dev/null http://localhost:5173; do sleep 1; done`.

   Expected/benign log noise, not bugs:
   - worker `coin-registry-sync`: `cmcSource: "placeholder"` — CMC integration isn't wired yet (MVP module 3 scope, mocked coin list by design, see CLAUDE.md MVP table).
   - api: `Route GET:/ not found` (404) on the bare root — `apps/api` has no `/` handler at all. Check `/health` instead if you need to confirm the API itself is alive.

## Telegram auth link (ngrok) — the part that's easy to get wrong

**The tunnel must point at `apps/web` (port `5173`), not `apps/api` (`3001`).** The Telegram Login Widget page is rendered by the web app; `apps/api` alone has no HTML page and will 404 on `/`, which looks broken but is a symptom of tunneling the wrong port, not an app bug.

`apps/web/vite.config.ts` is already set up for this:

- `allowedHosts: [".ngrok-free.app"]` — any ngrok-free.app subdomain is accepted, no vite config edits needed per session.
- `server.proxy` forwards `/auth`, `/settings`, `/watched-wallets`, `/coins`, `/realtime` (incl. websocket) to `localhost:3001` — so the browser only ever talks to the single web-facing ngrok origin, and vite proxies API calls server-side. This sidesteps a known issue where ngrok's free-tier edge doesn't reliably forward non-preflight PATCH requests cross-origin.

Steps:

```bash
nohup ngrok http 5173 --log=stdout > /tmp/ngrok.log 2>&1 &
disown
sleep 3
curl -s http://127.0.0.1:4040/api/tunnels   # read out public_url
```

Then **update `apps/web/.env`**: set `VITE_API_URL` to that same public URL (same-origin, so it rides the proxy above — do not point it at a `:3001` tunnel). Vite only reads `.env` at process startup, so after editing it you must restart the web dev server for it to take effect (restarting the whole `turbo run dev` from step 3 is simplest and safe).

Verify before handing the link back:

```bash
curl -s -o /dev/null -w '%{http_code}' -H "ngrok-skip-browser-warning: true" https://<new-subdomain>.ngrok-free.app/
```

Expect `200` with HTML containing `<title>HyperTracker</title>`, not `404`.

Give the user the **bare domain, no path** — that's what goes into BotFather's `/setdomain`:

```
https://<subdomain>.ngrok-free.app
```

**Free ngrok subdomains rotate on every `ngrok` restart.** If ngrok was restarted since the last session (it wasn't reused from a still-running process), the whole "get URL → update `VITE_API_URL` → restart web → verify 200 → hand back domain" sequence must run again — don't hand back a stale URL from memory or from `apps/web/.env` without re-checking `http://127.0.0.1:4040/api/tunnels` first.

## Quick health check for an already-running stack

Before assuming nothing is up, check first — don't blindly restart:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
curl -s http://127.0.0.1:4040/api/tunnels   # existing ngrok tunnel, if any
ps aux | grep -E "turbo run dev|vite|tsx watch" | grep -v grep
```
