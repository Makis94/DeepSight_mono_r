# Build context is the repo root (monorepo) — see docker-compose.prod.yml's
# `build.context: .` / `build.dockerfile: apps/worker/Dockerfile`.
# One image, six processes: docker-compose.prod.yml runs six containers from this same
# image, each overriding `command:` to a different dist/<worker>/index.js entry point (see
# apps/worker/tsup.config.ts for the six entries) — per CLAUDE.md, each worker is an
# independent process and must not go down together with the others, so each gets its own
# container/restart policy rather than one process spawning six in-process workers.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat wget
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo@^2.3.3 prune @hypertracker/worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN npx turbo@^2.3.3 run build --filter=@hypertracker/worker

FROM base AS runner
RUN addgroup --system --gid 1001 hypertracker && adduser --system --uid 1001 hypertracker
WORKDIR /app
COPY --from=installer --chown=hypertracker:hypertracker /app .
USER hypertracker
WORKDIR /app/apps/worker
# HEARTBEAT_PORT is set per-service in docker-compose.prod.yml (each of the six workers
# gets its own process default — see apps/worker/src/shared/env.ts callers). Shell form
# (not exec/JSON array) so $HEARTBEAT_PORT is substituted at check time from the
# container's actual env, not baked in at build time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://localhost:${HEARTBEAT_PORT:-9101}/healthz" || exit 1
# Overridden per service in docker-compose.prod.yml; this default just makes the image
# runnable standalone for local testing.
CMD ["node", "dist/wallet-watcher/index.js"]
