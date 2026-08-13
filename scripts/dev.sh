#!/usr/bin/env bash
# Local dev bootstrap: Postgres (docker) -> migrations -> api + web dev servers.
# Does NOT start apps/worker or apps/bot — worker needs no extra env (DATABASE_URL only)
# so add --filter=@hypertracker/worker below once you also want live events flowing;
# bot needs a real BOT_TOKEN in apps/bot/.env, which doesn't exist yet.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="postgres://hypertracker:hypertracker@localhost:5432/hypertracker"
CONTAINER="hypertracker-postgres-1"

echo "==> Starting Postgres (docker compose)..."
docker compose up -d postgres

echo "==> Waiting for Postgres to become healthy..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo starting)" = "healthy" ]; do
  sleep 1
done
echo "==> Postgres is healthy."

echo "==> Running migrations..."
DATABASE_URL="$DB_URL" pnpm --filter @hypertracker/db db:migrate

echo "==> Starting api + web (Ctrl+C to stop both)..."
exec pnpm turbo run dev --filter=@hypertracker/api --filter=@hypertracker/web
