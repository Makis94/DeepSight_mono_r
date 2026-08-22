#!/usr/bin/env bash
# Production deploy: pull latest main -> build images -> run migrations -> restart stack.
# Runs ON THE VM (see .github/workflows/deploy.yml, which SSHes in and calls this), or by
# hand over SSH for a manual deploy. Assumes the repo is already cloned at this path with
# a real `.env` present (see .env.production.example) — this script does not create either.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Pulling latest main..."
git fetch origin main
git reset --hard origin/main

echo "==> Building images (one at a time — the VM only has 2GB RAM, building all"
echo "    8 images in parallel starves it and can take down the live containers)..."
docker compose --parallel 1 -f docker-compose.prod.yml build

echo "==> Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @hypertracker/db db:migrate

echo "==> Restarting stack..."
docker compose -f docker-compose.prod.yml up -d

echo "==> Pruning old images..."
docker image prune -f

echo "==> Deploy complete. Status:"
docker compose -f docker-compose.prod.yml ps
