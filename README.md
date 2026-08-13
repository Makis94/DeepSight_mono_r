# HyperTracker

Мониторинг активности на Hyperliquid: отслеживание кошельков (fills, funding, депозиты/выводы) и рынка (крупные сделки по монетам), с уведомлениями в Telegram.

## Стек

- **Turborepo + pnpm workspaces** — монорепозиторий
- **apps/web** — React + Vite + TS, админ-панель (заготовка)
- **apps/api** — Fastify + TS, REST для web/bot, health-check
- **apps/bot** — grammY + TS, Telegram-бот, читает шину событий и шлёт уведомления
- **apps/worker** — три независимых долгоживущих процесса (wallet-watcher, market-watcher, deposit-watcher), НЕ смешаны с HTTP-сервером api
- **packages/shared** — общие Zod-схемы, типы, константы
- **packages/db** — Drizzle ORM + PostgreSQL, единая точка доступа к БД
- **packages/hyperliquid-sdk** — типизированная обёртка над Hyperliquid REST/WS API
- **packages/eslint-config, packages/tsconfig** — общие конфиги

## Поток данных

```
┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────────────────┐
│ Hyperliquid WS        │  │ Hyperliquid WS        │  │ Arbitrum (Bridge2)         │
│ userEvents/userFills/  │  │ trades (по монетам)   │  │ через The Graph subgraph  │
│ orderUpdates/          │  │                        │  │ (HTTP GraphQL)            │
│ userFundings/          │  │                        │  │                           │
│ userNonFundingLedger   │  │                        │  │                           │
└──────────┬────────────┘  └──────────┬────────────┘  └──────────┬────────────────┘
           │                          │                          │
           ▼                          ▼                          ▼
   apps/worker/               apps/worker/               apps/worker/
   wallet-watcher             market-watcher             deposit-watcher
   (динамические подписки,    (пул WS-соединений,        (DepositSource interface,
    дедуп на снапшотах)        распределение монет)        The Graph как источник A)
           │                          │                          │
           └──────────────┬───────────┴──────────────┬───────────┘
                          ▼                          │
                   packages/db (Drizzle)               │
                   INSERT INTO events                  │
                          │                            │
                          ▼                            │
             ┌────────────────────────────┐            │
             │ PostgreSQL LISTEN/NOTIFY    │◄───────────┘
             └──────────────┬─────────────┘
                             ▼
                       apps/bot
                (notifier: LISTEN канал → events →
                 матчинг с users/watched_wallets/
                 настройками → Telegram)
                             │
                             ▼
                      Telegram-пользователь

apps/web ──HTTP──► apps/api ──Drizzle──► packages/db
apps/bot ──Drizzle (напрямую)──► packages/db
```

Шина событий на первом этапе — **PostgreSQL LISTEN/NOTIFY** поверх таблицы `events`: воркеры пишут события и шлют `NOTIFY`, `apps/bot` держит постоянное подключение и слушает канал. Переход на BullMQ/Redis рассматривается отдельно при росте нагрузки — интерфейс notifier'а в боте спроектирован так, чтобы такой переход не требовал переписывания бизнес-логики.

## Архитектура воркеров

Каждый воркер — отдельный процесс/entrypoint (`apps/worker/src/<name>/index.ts`, собираются в `dist/<name>/index.js`), не рестартуется вместе с другими воркерами или с `apps/api`.

- **wallet-watcher** — подписки на события по отслеживаемым адресам, динамическое добавление/удаление без рестарта, реконнект + дедупликация на снапшотах.
- **market-watcher** — пул из нескольких WS-соединений с распределением монет (лимиты подписок/соединений на IP — конфигурируемые), фильтрация по минимальной сумме сделки на своей стороне.
- **deposit-watcher** — депозиты видны только на Arbitrum-бридже (контракт Bridge2), поэтому реализован через `DepositSource` интерфейс: вариант А (The Graph subgraph, HTTP GraphQL) — текущая реализация; вариант Б (прямое подключение к Arbitrum RPC) — точка расширения на будущее.

Каждый воркер поднимает отдельный heartbeat HTTP-эндпоинт (`/healthz`, порт из конфига) для мониторинга состояния WS-соединения независимо от HTTP-сервера `apps/api`.

## Разработка

```bash
pnpm install
docker compose up -d       # PostgreSQL
cp apps/api/.env.example apps/api/.env
cp apps/bot/.env.example apps/bot/.env
cp apps/worker/.env.example apps/worker/.env
pnpm dev                   # turbo run dev во всех apps
```

```bash
pnpm build      # turbo run build
pnpm lint       # turbo run lint
pnpm typecheck  # turbo run typecheck
pnpm test       # turbo run test
```

## Статус

Каркас монорепозитория и голые скелеты всех приложений готовы. Схема БД (`packages/db`), `packages/hyperliquid-sdk` (после сверки с официальной документацией Hyperliquid) и первая реальная фича — вертикальный срез wallet-watcher (тестовый адрес → событие → БД → уведомление в Telegram) — следующие шаги.
