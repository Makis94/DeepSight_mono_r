# Build context is the repo root (monorepo) — see docker-compose.prod.yml's
# `build.context: .` / `build.dockerfile: apps/bot/Dockerfile`.
# The bot runs grammY in long-polling mode (see apps/bot/src/index.ts, bot.start()) —
# no inbound HTTP/webhook, so this image exposes nothing.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo@^2.3.3 prune @hypertracker/bot --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN npx turbo@^2.3.3 run build --filter=@hypertracker/bot

FROM base AS runner
RUN addgroup --system --gid 1001 hypertracker && adduser --system --uid 1001 hypertracker
WORKDIR /app
COPY --from=installer --chown=hypertracker:hypertracker /app .
USER hypertracker
WORKDIR /app/apps/bot
CMD ["node", "dist/index.js"]
