# CLAUDE.md — Project Rules

This file is read automatically at the start of every Claude Code session in this repository. The rules below are mandatory, not suggestions.

## Project

Telegram bot + backend service for monitoring activity on Hyperliquid (deposits, watched wallets, large trades across the top-250 CoinMarketCap coins). Monorepo: Turborepo + pnpm workspaces.

Structure:

- `apps/api` — Fastify REST API (also hosts the realtime WS/SSE gateway for `apps/web`)
- `apps/bot` — Telegram bot
- `apps/worker` — long-running WS/bridge workers (wallet-watcher, market-watcher, deposit-watcher)
- `apps/web` — **client-facing** React app, NOT an admin panel. End users configure what to track (wallets, thresholds, notification types) and see live data (positions, events feed) here. Mobile-first, built to run both as a standalone site and as a Telegram Mini App from day one.
- `packages/hyperliquid-sdk` — typed wrapper over Hyperliquid API
- `packages/db` — Drizzle ORM + PostgreSQL
- `packages/shared` — shared types, Zod schemas, and the unified Telegram auth module

## apps/web — client app, mobile-first, dual context (site + Mini App)

`apps/web` is not an internal admin tool — it is a product surface for end users, equivalent in importance to the Telegram bot. Two things follow from this:

1. **Mobile-first by default.** Design and build for a narrow viewport first, not as an afterthought. Use the `frontend-design` skill for layout/typography decisions rather than defaulting to generic desktop-first templates.
2. **Dual runtime context: standalone browser site AND Telegram Mini App, from the start — not sequentially.** Detect context at runtime (`const isMiniApp = !!window.Telegram?.WebApp`) and branch UI behavior on it:
   - Auth method shown (Login Widget vs automatic Mini App `initData`)
   - Navigation: use Telegram's native `MainButton`/`BackButton` inside Mini App context instead of custom UI controls
   - Theming: pull colors from Telegram `themeParams` inside Mini App context; use the app's own theme in standalone-site context
   - Do not build two separate codebases/apps for this — one `apps/web`, with a context layer, not a fork.

## Unified Telegram identity — single source of truth for auth

There is exactly one canonical user identity across the whole system: `telegram_id`. Do not introduce a separate email/password or OAuth identity system — it would create a second identity model that has to be reconciled with the bot's `telegram_id` later.

Two verification paths, one resulting session type:

- Standalone site → Telegram Login Widget → verify signed payload (HMAC against bot token)
- Mini App → Telegram WebApp `initData` → verify signature (different HMAC scheme, same bot token)

Both paths live in `packages/shared` (or a dedicated `packages/auth` if it grows large) as `verifyLoginWidget()` and `verifyMiniAppInitData()`, both producing the same internal session type. `apps/api`, `apps/bot`, and the realtime gateway must consume only that unified session — they should never need to know whether the user arrived via the website or the Mini App.

## Realtime channel (apps/web live data)

`apps/web` needs live updates (positions, incoming events) in addition to the Telegram bot notifications — this is a second consumer of the event pipeline, not a replacement for the bot. The realtime gateway (WebSocket or SSE, inside `apps/api` or a dedicated `apps/realtime` if kept isolated) reads from the same event bus (`events` table + LISTEN/NOTIFY, or the chosen queue) and pushes only the events relevant to the authenticated user's watched wallets/filters — never a global broadcast. It authenticates with the same unified session described above, not a separate mechanism.

## TypeScript — strict rules, no exceptions

1. **`any` is forbidden everywhere.** In new code and in edits to existing code alike. This covers:
   - explicit `: any`
   - implicit any (TS inferring `any` due to a missing type) — this is an error too, never silence it
   - `as any` to bypass type errors — forbidden. If types don't line up, either the type is wrong or the code structure is wrong — fix the cause, not the symptom
   - `// @ts-ignore` and `// @ts-expect-error` without an explicit written justification in a comment right next to it (reserved for genuine edge cases, e.g. a bug in a third-party package's types) — these must stay the exception, never the pattern

2. **`tsconfig.json` in every package extends `packages/tsconfig`** and must include:

   ```json
   {
     "strict": true,
     "noImplicitAny": true,
     "noUncheckedIndexedAccess": true,
     "exactOptionalPropertyTypes": true,
     "noFallthroughCasesInSwitch": true
   }
   ```

3. **All external data (API responses, WebSocket messages, user input, database rows) is validated with Zod at the system boundary**, never cast with `as SomeType`. The Zod schema is the single source of truth for the type — derive the type via `z.infer<>`, don't hand-write a separate interface next to it, or the two will drift apart over time.

4. **Monetary amounts (USDC, PnL, volumes)** — decimal strings or a fixed-point/BigInt-based type only. Never `number`/float. This is also pinned down in the `deposit-monitoring-architecture` skill, but the rule applies project-wide, not just to deposits.

5. If a task seems to require `any` to get unstuck, treat that as a signal to stop and ask, not a reason to give up and write `any`. The correct path is almost always: describe the type more precisely via generics, a discriminated union, or `unknown` + a type guard.

   ## Working with the Hyperliquid API — mandatory MCP verification

   This project has the `hyperliquid-docs` MCP server connected.

   **Rule:** any code that reads or writes anything related to the Hyperliquid API (REST endpoints, WebSocket subscriptions, response field formats, rate limits, mainnet/testnet URLs) must be verified against the MCP `hyperliquid-docs` source — never written from the model's memory. Training data can be stale; the Hyperliquid API changes.

Specifically verify before:

- adding a new WebSocket subscription or changing how an existing one is handled
- changing which fields are parsed from Hyperliquid responses (REST or WS)
- hardcoding any specific numeric rate limit in code — every such number needs a comment: `// source: hyperliquid-docs MCP, verified: YYYY-MM-DD`
- implementing any part of `packages/hyperliquid-sdk`

If the MCP is unavailable at the time, say so explicitly — don't guess from memory and don't act as if verification happened.

For this class of task, the project has a dedicated subagent, `hyperliquid-api-reviewer` — invoke it explicitly after changes to `packages/hyperliquid-sdk` or `apps/worker` whenever you're not 100% certain the fields/endpoints used are current.

## Active project skills

- `hyperliquid-ws-patterns` — reconnect logic, snapshot handling, rate limits, connection pooling for WebSocket
- `deposit-monitoring-architecture` — architecture for global deposit monitoring (The Graph, the `DepositSource` interface)

These skills should trigger automatically based on task context. If a task clearly touches WS logic or deposits but the skill didn't load, read it explicitly before writing code.

## MVP scope — the 4 core modules

The MVP consists of exactly 4 functional modules from the spec. Keep this list authoritative — don't let scope silently drift or expand mid-implementation without flagging it explicitly.

1. **Deposit monitoring (global, any address)** — user sets a minimum deposit threshold (e.g. $500k+), gets notified with wallet address and amount for ANY deposit above it, not just watched wallets.
   - Hyperliquid's own API does NOT provide this — there is no "all deposits, all users" endpoint or subscription. Deposits are an on-chain event on the Arbitrum Bridge2 contract.
   - Solved via the `DepositSource` abstraction (see `deposit-monitoring-architecture` skill), currently backed by a The Graph subgraph indexing Bridge2.
   - Recommended polling interval: 30–60s, to stay within The Graph's free tier (100k queries/month) — do not poll more aggressively than needed; $500k+ deposits don't require sub-30s latency.

2. **Watched wallet tracking (specific addresses)** — user adds any address, gets notified of all activity on it: open long/short, close, increase/decrease, TWAP, deposits/withdrawals.
   - Fully solved by Hyperliquid's own WebSocket API: `userEvents`, `userFills`, `orderUpdates`, `userFundings`, `userNonFundingLedgerUpdates`. No external dependency.

3. **Large trade monitoring (top-250 CoinMarketCap ∩ Hyperliquid-listed coins)** — user sets a minimum trade size (e.g. $100k+), gets notified of large trades across that coin list.
   - This is the ONLY module needing CoinMarketCap: Hyperliquid has no concept of "market-cap rank" — it only knows what it lists. CMC (or an equivalent ranked-list source) is required to determine which of its listed coins are in the global top-250.
   - CMC API key: sign up at pro.coinmarketcap.com, free Basic/Free tier is sufficient (periodic cron job, not per-request usage). Key lives only in `apps/worker`'s env, never exposed to `apps/web`.
   - Trade data itself comes from Hyperliquid's `trades` WebSocket subscription per coin, pooled across multiple connections per `hyperliquid-ws-patterns`.

4. **User settings** — thresholds, notification type toggles, watched-wallet CRUD.
   - Pure internal feature: own database + Telegram bot + web client. No external API dependency at all.

**Quick reference — external dependency per module:**

| Module                    | Needs CMC API? | Needs The Graph / Arbitrum? | Hyperliquid API sufficient alone? |
| ------------------------- | -------------- | --------------------------- | --------------------------------- |
| 1. Deposits (global)      | No             | Yes                         | No                                |
| 2. Watched wallets        | No             | No                          | Yes                               |
| 3. Large trades (top-250) | Yes            | No                          | No (needs CMC too)                |
| 4. User settings          | No             | No                          | N/A (no external API)             |

Module 3 (CMC dependency) can be temporarily mocked with a static coin list if the CMC key isn't ready yet — this does not block work on modules 1, 2, or 4.

## Post-MVP: full-fidelity tracking beyond the 10-wallet cap

Module 2 (watched wallets) has two tracking modes: `precise` (native Hyperliquid user-specific WS subscriptions — full fidelity, incl. `closedPnl`, native `dir`, TWAP, deposits/withdrawals/funding) and `common` (public `trades` feed, unlimited wallets, but missing those fields — see `packages/shared/src/schemas/events.ts` and `apps/api/src/modules/watched-wallets/precise-slots.ts`). `precise` is hard-capped at 10 wallets platform-wide because Hyperliquid enforces a **10-unique-user limit across all user-specific WS subscriptions per IP address** (confirmed via `hyperliquid-docs` MCP, `rate-limits-and-user-limits` page) — this is not raiseable via API key, account tier, or trading volume.

Decision: the only real way to give `common`-tracked wallets full fidelity is running our **own Hyperliquid non-validating node** with `--write-fills` (streams fills for ALL users in the same format as `userFills`, since it reads L1 consensus directly rather than a rate-limited subscription — see `github.com/hyperliquid-dex/node` and the `Historical data`/`Foundation non-validating node` MCP docs pages). Managed RPC providers (Chainstack, Dwellir, QuickNode) were evaluated and do not publicly document offering this specific fills-firehose — their documented offerings are standard rate-limited JSON-RPC/HyperEVM access, not a substitute. Self-hosting is also not clearly cheaper than a managed dedicated node once one is priced out (~$250–400/mo self-hosted vs. ~$400–500+/mo for a comparable managed dedicated node), so cost isn't the deciding factor between the two — a full node either way.

**This is explicitly scoped for after MVP ships**, not now — do not start building a node-backed data source as part of current MVP work without this being raised and confirmed first. When it is picked up, treat it the same way `deposit-monitoring-architecture`'s `DepositSource` was scoped: a plan shown first (new `apps/worker` ingestion service, schema changes, ops for running/monitoring the node) per the "show the plan first" rule below, before any code.

## Claude Design workflow for apps/web

Do not design screens in Claude Design before `apps/web` has a basic skeleton with real design tokens and a handful of base components — designing in a vacuum first produces screens that don't match the project's actual tokens/components and have to be reconciled later.

Order of operations:

1. `apps/web` skeleton exists first: design tokens, base components, the Mini App/standalone context-detection layer.
2. Run `/design-sync` (pull) so Claude Design imports the real design system from this codebase.
3. Design individual screens/features in Claude Design using the real components.
4. Hand off via Export → "Handoff to Claude Code" (or "Send to Claude Code Web").
5. After implementing, run `/design-sync` (push) to keep the Claude Design canvas in sync with what was actually built.

Any screen handed off from Claude Design must still respect the mobile-first and dual-context (site/Mini App) rules above — Claude Design is not aware of Telegram's `themeParams`/`MainButton` constraints unless the synced design system already encodes them.

## General principles for this project

- Each worker (`apps/worker/*`) is an independent process and must not go down together with `apps/api`.
- All database schema changes go through Drizzle migrations — never edit tables by hand outside of migrations.
- Before implementing a new feature that touches multiple packages in the monorepo — show the plan first (which files/packages will change), wait for confirmation, then write code.
- Never leave silent stubs/TODOs — if something isn't fully implemented, say so explicitly in the response rather than leaving it to be discovered by accident later.
