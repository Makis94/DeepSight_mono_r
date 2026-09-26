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

Decision (superseded, re-evaluate — see note below): the only real way to give `common`-tracked wallets full fidelity is running our **own Hyperliquid non-validating node** with `--write-fills` (streams fills for ALL users in the same format as `userFills`, since it reads L1 consensus directly rather than a rate-limited subscription — see `github.com/hyperliquid-dex/node` and the `Historical data`/`Foundation non-validating node` MCP docs pages). Self-hosting is also not clearly cheaper than a managed dedicated node once one is priced out (~$250–400/mo self-hosted vs. ~$400–500+/mo for a comparable managed dedicated node), so cost isn't the deciding factor between the two — a full node either way.

**Correction (2026-08-27):** the "Chainstack/Dwellir/QuickNode don't document a fills-firehose" claim above is now known to be wrong for QuickNode, at least — re-checked directly against `quicknode.com/docs/hyperliquid` (their docs, not the `hyperliquid-docs` MCP, since this is QuickNode's product, not Hyperliquid's own API). QuickNode documents a "HyperCore Data Streams" product with per-user-unrestricted datasets: `TRADES`, `TWAP`, `ORDERS`, `EVENTS`, etc., delivered via WebSocket or gRPC. The `TWAP` dataset specifically emits an `activated` status event at TWAP order creation (not just at `finished`/`terminated`), with `twap_id`/`user`/`coin`/`sz`/`executedSz`/`executedNtl`/`side`/`minutes` fields, and `TRADES` entries carry a `twapId` to correlate individual fills back to the parent order. This is real-time push (WS/gRPC), not a polling-only historical export. Gating: not on the free trial — `/hypercore` (JSON-RPC/WebSocket/gRPC) requires **QuickNode Build plan or higher** ($49/mo+, metered by API credits on data volume — cost scales with filtering/volume, no flat number confirmed). This directly undercuts the "self-host a node" conclusion above for at least the TWAP-notification use case and should be re-evaluated before more post-MVP node work is scoped — did not re-verify whether this same QuickNode product also covers the full `userFills`-equivalent needed for non-TWAP `common`-mode fidelity (open/close/increase/decrease), so don't assume it's a full substitute for the node decision without checking that separately.

**This is explicitly scoped for after MVP ships**, not now — do not start building a node-backed data source as part of current MVP work without this being raised and confirmed first. When it is picked up, treat it the same way `deposit-monitoring-architecture`'s `DepositSource` was scoped: a plan shown first (new `apps/worker` ingestion service, schema changes, ops for running/monitoring the node) per the "show the plan first" rule below, before any code.

## Post-MVP: TWAP auto-trading (in-app trade opening) — spec received 2026-09-20, branch `feature/DS-014-in-app-trade-opening`

**Status (updated 2026-09-23): Phase A (paper trading) substantially built, piece by piece, each package confirmed with the customer before the next started** — see the Progress log below for exactly what's ✅ vs ⬜. This is a new product surface (the app will eventually place real orders with real user funds) — every formula below is still an **open calibration question** (needs backtest / customer input), not a settled decision, and Phase B (real order signing/placement) has not been started and needs its own plan+confirmation when picked up.

### Spec (customer text, translated)

Software watches large Hyperliquid TWAP orders and automatically opens positions off them, using a price-impact estimate for SL/TP, the initiating wallet's reputation, and aggregate parallel-TWAP pressure.

1. **Triggers — two tiers by asset capitalization/liquidity.** Tier A (large: ZEC, HYPE and similar): base value for ZEC ≥ $500,000 over 5 min; thresholds for other Tier A assets are *derived* from the base, adjusted for that coin's capitalization and order-book depth (not one fixed number). Tier B (less liquid: ARB, UNI and similar): base ≥ $300,000 over 5 min, same derivation. Dev task: a threshold-normalization formula inside a tier (e.g. by average daily volume or market cap relative to the tier's base coin).
2. **Trust Score per wallet** (e.g. −100…+100, decaying over time) → multiplier on future position size for that wallet's signals. Fully executed TWAP: + (may raise size). Cancelled before first execution: − (large penalty). Cancelled mid-execution: − (smaller penalty). 2+ cancellations (cumulative): extra reduction, enter with deliberately smaller size on all future signals from that wallet. Dev task: score scale, time-decay formula, score→size-multiplier formula.
3. **Price-impact estimate** on each new TWAP signal: take current order-book depth for the asset, estimate the % price move over the TWAP's execution from order size vs. liquidity across book levels, derive the "maximum potential" move range.
4. **Main trade SL/TP.** Stop-Loss from the computed price impact. Take-Profit NOT at the full computed potential but at a reasonable fraction (starting hypothesis TP = 60–70% of the computed max move — must be justified and backtested).
5. **Position size** = base size × Trust-Score multiplier of the signalling wallet.
6. **Reverse trade after the main position closes — DESCOPED (customer decision 2026-09-22).** Original spec text, kept for record: sell-TWAP on ZEC $800k / 5 min → open short → TP fires normally. If TP fired at ≈95% TWAP execution (configurable), open the opposite position (long). Reverse trade: new potential computed by the price-impact logic but applied to the remaining "tail" of the TWAP (last ~5% of volume) plus a possible short-term bounce after seller/buyer pressure ends; its TP is smaller than the main TP (shorter, smaller retracement target); its SL is recomputed to the reduced scale. **Customer confirmed: we open the main trade in the TWAP's own direction only. We do NOT open the reversal position at ~95% execution.** Do not build item 6 — no reversal-trigger detection, no reverse-trade sizing/TP/SL logic, no `TRADES`-stream execution-progress tracking whose only purpose was the reversal trigger.
7. **Parallel / accumulated TWAPs.** While a trigger TWAP runs, other TWAPs (short and long) on the same asset add aggregate pressure and must not be ignored. Continuously track ALL active TWAPs per asset (not only those passing the trigger threshold); aggregate buy and sell volume separately over a sliding window (e.g. last 10 min — parameter); expose "net flow" (buy-TWAP sum − sell-TWAP sum) as a background pressure indicator; on every new trigger signal check it. Example: trigger sell-TWAP $800k/5min arrives while ~10 longer (60 min) buy-TWAPs sit on the same asset and their in-window volume exceeds the trigger's → reduce size, skip the trade, or apply a reducing coefficient. Dev task: all-active-TWAP monitor with sliding-window aggregation (window and tracked types parameterized) and a formula f(counter_volume / trigger_volume) for the size/decision.

Open questions (not resolved in the spec): threshold normalization formula (1); Trust Score scale + decay (2); TP coefficient vs. computed max move (4); counter-flow → size/decision formula (7). (Item 6's reversal-threshold/TP-SL-shrink question is moot — item 6 is descoped, see above.)

### Feasibility check against docs (2026-09-20) — what the data/execution layers actually give us

Sources: `hyperliquid-docs` MCP (Hyperliquid's own API) + `quicknode.com/docs/hyperliquid` (QuickNode's own product, not covered by the MCP). Numbers here are verified as of that date; re-verify before hardcoding any (per the rules above, every hardcoded limit needs a `// source: ..., verified: YYYY-MM-DD` comment).

**Signal side — feasible, QuickNode is mandatory for it.**

- Hyperliquid's own TWAP feeds (`twapStates`, `userTwapHistory`, `userTwapSliceFills`) are **user-specific** subscriptions → capped at 10 unique users per IP; useless for market-wide monitoring. Global TWAP feed = QuickNode `TWAP` dataset (already used by `apps/worker/src/twap-watcher`). Requires QuickNode Build plan+ (Free Trial has no streaming access).
- TWAP dataset emits **one event per state change** (no periodic progress): statuses `waitingForTrigger | activated | finished | stopped | terminated | {error}`; `state` carries `coin,user,side,sz,executedSz,executedNtl,minutes,reduceOnly,randomize,timestamp,trigger,stopPx`. Filterable server-side by `user/coin/side/status` only — **no notional filter** (thresholding stays client-side, as today).
- (Execution-progress tracking via `TRADES` stream `twapId:["*"]` for a "≈95%" reverse trigger is **not needed** — item 6/reversal is descoped, see above.) Still relevant generally: HL docs say a TWAP fires a suborder at most every 30s (5-min TWAP ≈ 10 slices), each suborder ≤3% slippage, catch-up suborders up to 3× normal size, `randomize` ±20% per suborder, min running time 5 min, max 7 days, min $100 notional.
- **Trust Score classification limits:** `terminated` = "cancelled or otherwise terminated before its execution window ended" — user cancel vs. other termination is **not distinguishable** from the event alone; use `executedSz` (0 → cancelled before first execution; 0<executedSz<sz → mid-execution). `stopped` (price boundary) and `{error}` (e.g. insufficient margin) are separate statuses and must NOT be scored as cancellations. `finished` does not guarantee `executedSz == sz`. QuickNode stream is forward-only (no history/snapshot) → per-wallet history has to be accumulated by us or backfilled via `twapHistory` info (weight 20 + per-20-items on HL REST; 20 credits on QuickNode `/info`).
- **All-active-TWAP monitor (item 7):** the stream already delivers every TWAP; current `twap-watcher` drops those under `TWAP_MIN_NOTIONAL_USD` (default $100k) before persisting — the aggregator needs the unfiltered stream. Active set is rebuilt from events; it is lost on restart/reconnect (no snapshot) → must be persisted.
- `reduceOnly` TWAPs are position-closing flow, not fresh directional intent — the spec doesn't say how to treat them (decision needed).

**Order-book / price impact — feasible, with a depth caveat.**

- HL `l2Book` (REST/WS, not user-specific): **max 20 levels per side**, optional `nSigFigs` (2–5) aggregation for wider price range; REST weight 2. HL does not provide an impact model — `impactPxs` in `metaAndAssetCtxs` is only the average price for the _funding impact notional_ (20,000 USDC BTC/ETH, 6,000 USDC others), not for $500k+. Also available in `metaAndAssetCtxs`: `dayNtlVlm`, `openInterest`, `markPx` (usable for tier thresholds / normalization).
- QuickNode `/info` does **not** serve `l2Book`; deeper book (up to 100 levels) is gRPC-only `StreamL2Book` (one coin per stream; Build plan = 5 concurrent streams, so per-coin streaming doesn't scale — prefer an on-demand HL REST `l2Book` snapshot at signal time). OrderBook gRPC methods bill 10 credits per 0.0165 MB (≈6× the rate of standard streams). How the book _replenishes_ during a 5-min TWAP is not in any doc — the impact model is a research/backtest problem, not an API lookup.

**Execution side — feasible via Hyperliquid's native `/exchange`; several hard constraints.**

- Actions available: `order` (limit `Alo|Ioc|Gtc`, trigger `tp|sl` with `isMarket`/`triggerPx`, `grouping: na|normalTpsl|positionTpsl`, optional `builder {b,f}`), `cancel/cancelByCloid`, `modify`, `updateLeverage`, `scheduleCancel` (dead-man's switch), `twapOrder/twapCancel`. Min order $10; actions expire if not accepted in 15s (`expiresAfter` available); market-order max value depends on asset max leverage ($30M … $500k).
- TP/SL are triggered by **mark price** (not last trade); market TP/SL have **10% slippage tolerance** — use limit TP/SL to bound it; TP/SL orders must be reduce-only; bracket via `normalTpsl` grouping.
- **Custody model = API (agent) wallet.** User signs `approveAgent` once with their own wallet; we hold only the agent key and sign orders with it. Constraints: 1 unnamed + up to 3 named agents per account; expiry ≤180 days (renewal needs a fresh user signature); nonces tracked per signer (100 highest, window T−2d…T+1d) — one agent per trading process, and **never reuse an agent address after deregistration** (nonce set is pruned → replay risk). Queries must use the master account address, not the agent's. Agent-signable actions include `agentSendAsset` (destination must equal source — no exfiltration path documented) and abstraction setters; `withdraw3` ("Initiate a withdrawal request") is a separate action and the pages read do **not** state which signer it accepts — **not verified that an agent signature is rejected for it; confirm on testnet before any key custody design is accepted.** Custodial keys (we hold user private keys) are out of the question.
- **Rate limits that bite a multi-user platform:** REST 1200 weight/min per IP shared by everyone (exchange action = weight 1+⌊batch/40⌋, `l2Book/allMids/clearinghouseState/orderStatus` = 2, other info = 20); address limit = 1 request per 1 USDC traded cumulatively + 10,000 initial buffer, then 1 request/10s (cancels have a larger allowance); 1000 open orders base. **Watching each user's own fills/orders over HL WS is capped at 10 unique users per IP** — the TP-fill→reverse-trade loop for N users cannot rely on per-user WS; use polling of `orderStatus` by oid (weight 2), or QuickNode `TRADES` stream filtered by user (≤100 values per filter field, Build plan = 5 named filters/stream), or QuickNode `hl_batchOpenOrders`/`hl_batchClearinghouseStates` (5 credits per address).
- **QuickNode Exchange API (`/hypercore/exchange`, build → sign → send, 0 credits) is not a neutral pipe:** "transactions are appended with a builder fee during the build step" (QuickNode's builder code; own code only via white-label deal). Do not route user orders through it. **Decision (customer, 2026-09-22): no commission/builder fee on user trading volume for now** — send orders to Hyperliquid's own `/exchange` with no builder code (skip `approveBuilderFee` entirely), not QuickNode's pipe. Revisit only if the customer later asks for a builder fee; don't add one speculatively. QuickNode's Exchange API stays useful only as a reference for the build/sign/send flow and `preflight` validation, never as the actual order path.
- Wallet linkage: HL identity is a wallet address; `telegram_id` stays the only _app_ identity — the wallet is a linked attribute captured by the `approveAgent` signature (needs a wallet-connect/signing UX inside the Mini App and standalone site; unified-account mode users are limited to 50k actions/day, standard mode has no such cap).
- HIP-3 assets (`xyz:NVDA`, etc.) appear in the TWAP stream, use asset id `100000 + dex_index*10000 + index` and different fee/oracle rules — start with core perps only.

### Decision (customer, 2026-09-22): Hyperliquid-only for v1, multi-exchange-ready architecture from day one

Build and ship against Hyperliquid only first — no second exchange's signal/execution code in the initial implementation. But the plan must not hardcode Hyperliquid assumptions into the core auto-trading logic (Trust Score, price-impact estimate, threshold tiers, position sizing, risk limits). Same pattern as `deposit-monitoring-architecture`'s `DepositSource` abstraction (see MVP section above): define exchange-agnostic interfaces up front —

- a **signal source** interface (large-order/TWAP-equivalent events → normalized shape: asset, side, notional, wallet id, status), Hyperliquid/QuickNode as the first implementation
- an **execution adapter** interface (place/cancel/modify order, TP/SL, position query, wallet/key linkage), Hyperliquid `/exchange` as the first implementation
- exchange identity kept alongside `telegram_id`, not replacing it — a user's Hyperliquid wallet link is one linked account among possibly several exchanges later, mirroring how the WEEX referral work already treats an external exchange UID as a linked attribute, not a new identity system

Do not build a second exchange now — only keep the seam so adding one later is a new adapter, not a rewrite. Flag explicitly in the plan which pieces are genuinely Hyperliquid-agnostic vs. which (asset-id scheme, tick/lot size, rate limits, nonce/agent-wallet model) are inherently exchange-specific and just live behind the adapter.

### Constraints to carry into the plan (proposed — confirm before implementing)

- Amounts/PnL/sizes: decimal strings or fixed-point only (existing rule); TWAP stream already delivers decimals as strings.
- No trading keys and no signing in `apps/web`/`apps/bot`; agent keys encrypted at rest, with a global kill switch, per-user max position/loss limits, and a dry-run (paper) mode before any live order.

  **Clarified 2026-09-23** (code-review flagged this as a possible violation, worth settling explicitly rather than leaving ambiguous): "used only by a dedicated worker process" means **signing trade actions with the agent key** — that DOES belong in `apps/worker` only (Phase B, not built), same place `PaperExecutionAdapter`/the future live `ExecutionAdapter` already live. It does NOT mean key _generation/storage_ — `apps/api/src/modules/trading/routes.ts` generates the agent keypair and writes it encrypted (AES-256-GCM, `crypto.ts`) during the linking flow, and that is intentional, not a gap: linking is inherently a synchronous HTTP request/response (serve a payload to sign, accept the signature back) and `apps/worker` has no HTTP surface to build that on without giving it one just for this. `apps/api` never decrypts or signs with the agent key — Phase A's only use of it is storage; both processes read/write the same Postgres `trading_accounts` row regardless of which one wrote it first, so there is no meaningful exposure difference between "generated in api" and "generated in worker" today. Revisit if Phase B's design turns out to want otherwise.

- Everything Hyperliquid-facing goes through `hyperliquid-api-reviewer` + MCP verification; QuickNode facts need re-verification directly on their docs (MCP doesn't cover them).
- No builder fee / commission on user trading volume for v1 (see decision above).
- Signal and execution logic sit behind exchange-agnostic interfaces per the multi-exchange decision above, even though only Hyperliquid is implemented now.

### Decision (customer, 2026-09-22): one unified `apps/web` page, not a separate leaderboard page

`apps/web/src/features/trading/` is a **single page**, not split into a leaderboard route and a
separate account-settings route. One page contains:

- **Top TWAP performers table** — the trust-score leaderboard (`trust_scores`, external
  wallets we watch/score, not our own users).
- **The current user's own account section** — their linked Hyperliquid wallet status, the
  `approveAgent` authorization/linking flow (the actual EIP-712 signature happens client-side
  in the user's own wallet — see the multi-exchange execution-adapter notes above, we never
  hold the user's real private key), and account-level info.
- **A single checkbox/toggle** bound to `trading_accounts.tradingEnabled` — checked = trading
  active, unchecked = **soft stop** (matches the 2026-09-22 soft-pause decision already in
  `packages/db`: gates new entries only, any already-open `auto_trades` row keeps running to
  its own TP/SL regardless).

### Progress log (updates as pieces land — keep this current, don't let it silently drift from what's actually built)

- ✅ **`packages/trading-core`** — pure calibratable logic (tier thresholds, trust score,
  price impact, parallel flow, position sizing), 50 tests passing. No I/O.
  **Manipulation-defense pass (2026-09-22):** a scenario-based review (real numbers, not
  guesses — run via a throwaway script against the actual formulas) of `computeTrustScore`/
  `scoreToSizeMultiplier` found two real exploitable gaps before this: (a) as few as 10
  SAME-DAY `fully_executed` events maxed a wallet's score → 1.5x sizing, cheap to fake by
  bursting small TWAPs; (b) the size-multiplier floor (0.5x) never distinguished a mildly bad
  wallet from a severely/repeatedly bad one — nothing could ever be fully excluded. Fixed by
  `evaluateWalletTrust()` (new): a `confidence` factor (needs real TENURE — calendar days
  observed — AND event VOLUME before a wallet can earn a sizing BOOST above neutral)
  dampens the UPSIDE only; a bad/negative score is punished at full strength immediately, no
  grace period (asymmetric on purpose — a false positive risks real capital, a false
  negative only costs missed upside). Plus a new `blocked` state (effectiveScore crosses
  `blockThreshold`, default -90) that fully skips a wallet's signals — **this exact
  behavior is NOT in the original spec** (spec §3 only ever says "smaller size", never "stop
  following"), added as an explicit safety layer and flagged for customer sign-off; set
  `blockThreshold` to `-Infinity` to disable it and match the spec's literal text. Verified
  empirically: 10-same-day-execs case now stays at neutral 1.0x (was 1.5x); a genuine
  30-execution/90-day history still reaches full 1.5x (confidence=1); the 5-cancels-in-10-
  days case is now `blocked` (0x) instead of floored at 0.5x; a single isolated cancellation
  still only costs 0.85x, not a block. `trust_scores` gained `confidence`/`effective_score`/
  `blocked` columns (migration `0020_narrow_wolf_cub.sql`); `/trading/leaderboard` now ranks
  by `effectiveScore`, not raw `score`, for the same reason. **Still not backtested against
  real historical TWAP outcomes** — `maturityDays`/`minEventsForFullConfidence`/
  `blockThreshold`/`decayHalfLifeDays` remain calibration placeholders, now at least
  internally consistent and manipulation-resistant rather than just asserted correct. Revisit
  once `trigger_evaluations`/`trust_score_events` have real production data to replay
  against.
- ✅ **`packages/db`** migration `0017_clean_preak.sql` — `trading_accounts`, `trust_scores`,
  `trust_score_events`, `trigger_evaluations`, `auto_trades`, `risk_limits`,
  `auto_trader_global_config`.
- ✅ `packages/hyperliquid-sdk` — l2Book snapshot, metaAndAssetCtxs (dayNtlVlm), agent keypair
  generation (`agent-wallet.ts`, cross-checked against an independent Node-crypto derivation
  path, 12 tests), unsigned `approveAgent` EIP-712 payload builder (`signing.ts`, fields
  copied from the official Python SDK's source, not memory), submit-pre-signed-action.
  Reviewed by `hyperliquid-api-reviewer` (2026-09-22): one real bug found and fixed
  (`impactPxs` needed `.nullable()`, not just `.optional()` — Hyperliquid returns literal
  `null` for thin-liquidity/HIP-3 assets). **Real ORDER signing** (the agent wallet signing
  trade actions, msgpack+keccak+EIP-712 "Agent" struct) is Phase B only — Phase A's
  `PaperExecutionAdapter` never calls it, so it is deliberately NOT built yet.
  **OPEN VERIFICATION ITEM — RESOLVED 2026-09-24, `signatureChainId` confirmed correct:**
  `signing.ts`'s `USER_SIGNED_ACTION_SIGNATURE_CHAIN_ID = "0x66eee"` came from the Python
  SDK's source, not the MCP docs — the MCP's own worked EIP-712 examples use `"0xa4b1"`
  instead, and hyperliquid-api-reviewer could not corroborate `0x66eee` either way. Real
  testnet `approveAgent` round-trip done: a real MetaMask wallet signed the typed data built
  with `0x66eee` (domain `chainId: 421614`, Arbitrum Sepolia — MetaMask itself enforces the
  wallet's active-for-this-site network match `domain.chainId`, confirmed via a real RPC
  error, see the two bugs below), and Hyperliquid's testnet `/exchange` **accepted the
  signature** — it did not reject it as a bad signature/domain/chainId, it rejected it on an
  unrelated, legitimate business rule ("Must deposit before performing actions" — the test
  wallet has no mainnet deposit, see hyperliquid-docs MCP's own testnet-faucet page:
  `app.hyperliquid-testnet.xyz/drip` requires the SAME address to have deposited on mainnet
  first). A rejected/wrong signatureChainId would have failed signature verification, not
  hit a downstream account-state rule — this is real evidence `0x66eee` is correct. Full
  linking-flow confirmation (an actual `linkStatus: "linked"` row) still pending a funded
  testnet wallet trying again, but the specific chainId risk this item existed for is closed.
  **Two real bugs found and fixed only by actually testing this live** (neither was, or
  could have been, caught by typecheck/lint/tests — both are runtime wallet-interaction
  behavior): (1) `buildApproveAgentTypedData()`'s `types` object was missing an explicit
  `EIP712Domain` entry — caught and fixed in the third code-review pass, before this test,
  since it would have broken every real wallet's `eth_signTypedData_v4` outright. (2)
  MetaMask rejects `eth_signTypedData_v4` if `domain.chainId` doesn't match the wallet's
  currently-active-for-this-site network (RPC error -32603, confirmed live) — this can
  differ from the wallet's global network selector, so "ask the user to switch manually"
  isn't reliable. Fixed by having `apps/web/src/lib/wallet.ts`'s `signTypedData()` call
  `wallet_switchEthereumChain` (falling back to `wallet_addEthereumChain` with Arbitrum
  Sepolia params on error code 4902) before signing, instead of relying on the wallet
  already being on the right network.
- ✅ `apps/worker/src/auto-trader` — Phase A, paper only, own QuickNode WS connection
  (`signal-source.ts`, reuses `twap-watcher`'s `QuicknodeTwapSource`/`MidPriceCache`
  unmodified rather than duplicating them). Full pipeline wired: tier classification
  (`tier-config.ts` — **coin-tier membership beyond the spec's own ZEC/HYPE/ARB/UNI examples
  is a PLACEHOLDER, not customer-confirmed**, defaults an unclassified coin to the stricter
  Tier A rather than silently favoring it) → `l2Book`-based price impact → Trust Score
  (`trust-score-store.ts` + `trust-classification.ts`, DB-backed insert-only event log) →
  parallel-flow counter-check → per-account fan-out through `risk-guard.ts` (global kill
  switch + per-account soft pause + daily loss limit) → `paper-execution-adapter.ts` (pure
  simulation, implements `trading-core`'s `ExecutionAdapter`) → `position-monitor.ts` polls
  open trades for TP/SL. Every threshold-passing signal is logged to `trigger_evaluations`
  regardless of outcome (opened/skipped/reduced), per that table's own purpose.
  In-memory-only `ActiveTwapTracker` (no restart persistence) is a deliberate, documented
  Phase A limitation, not a silent gap — see `active-twap-tracker.ts`'s doc comment.
  Added `risk_limits.baseSizeUsd` via a new migration (0018) — the original 0017 shipped
  without a per-account "how much to risk per trigger" setting, an oversight caught while
  wiring this. Small, behavior-preserving edits to existing `twap-watcher` files were needed
  (see their own doc comments) to let auto-trader distinguish "stopped" (price-boundary
  self-stop, not scored) from "terminated" (real cancel, scored) — verified as a no-op for
  twap-watcher's own published output. 77/77 tests passing repo-wide (50 trading-core + 12
  hyperliquid-sdk + 10 worker + 5 api). Reviewed by `hyperliquid-api-reviewer` (2026-09-22): **no
  factual errors found**, including the highest-stakes item — `trigger-pipeline.ts`'s
  `l2Book` bids/asks tuple ordering and buy→asks/sell→bids side-selection (drives every
  SL/TP) — confirmed correct against the MCP's own worked L2-book example. One open,
  explicitly-flagged item (not a bug): `trust-classification.ts`'s "stopped" semantics come
  from QuickNode's own docs, outside the hyperliquid-docs MCP's coverage — the reviewer could
  not independently verify it through its own tools; re-confirm against QuickNode's docs (or
  a live stopPx TWAP) before trusting it for a Phase B/live scoring decision — see that
  file's own doc comment.
- ✅ `apps/api` trading routes (`modules/trading/routes.ts`) — link start/confirm (agent
  keypair generation + `approveAgent` EIP-712 payload, user's own wallet signs client-side,
  we submit the pre-signed action), account status toggle (soft pause), risk limits CRUD,
  leaderboard (ranked by `effectiveScore`), trades feed. Agent private key encrypted at rest
  (AES-256-GCM, `crypto.ts`, 5 round-trip/tamper tests). Entire module idle unless
  `AUTO_TRADER_LINKING_ENABLED=true` (default false) — this is the one path in the whole
  feature that can reach real Hyperliquid, so it stays off until the `signatureChainId` open
  verification item (see hyperliquid-sdk entry above) is actually confirmed on testnet.
- ✅ `apps/web/src/features/trading/` — the unified page (`TradingPage.tsx`), reachable from
  the account menu ("Auto-trading", `Header.tsx`), reusing the existing full-page-overlay
  pattern (`GuidePage`/`useMiniAppBackButton`) rather than adding a router. Sections:
  `AccountLinkCard` (connect wallet → sign `approveAgent` → confirm), `RiskLimitsForm`
  (baseSizeUsd/maxPositionUsd/maxDailyLossUsd), `LeaderboardTable` (ranked by
  `effectiveScore`, shows a Blocked badge), `TradesTable` (paper trades, polls every 15s). A
  persistent "Paper mode" banner makes it unambiguous nothing here is real money yet.
  Wallet signing (`lib/wallet.ts`) is a minimal EIP-1193 wrapper around the browser's
  injected `window.ethereum` — no viem/wagmi added, same "smallest dependency that does the
  job" call as `hyperliquid-sdk`'s `@noble/*` choice over a full wallet SDK.
  **Standalone-site only, by design** — a Telegram Mini App WebView doesn't inject
  `window.ethereum`; `AccountLinkCard` detects Mini App context and tells the user to open
  the site in a real browser instead of showing a button that would silently do nothing. A
  real Mini-App-compatible wallet flow needs actual WalletConnect integration, a separate,
  larger feature not built in this pass. All the OTHER sections (leaderboard, account
  status, risk settings, trade history) work in both contexts once a wallet is linked from
  the standalone site once. Typecheck/lint/production `vite build` all pass; the linking
  flow's actual browser+wallet behavior is NOT verified end-to-end (no Docker in this
  sandbox, see the entry below, and no real wallet extension to click through here either).
- ⬜ **Local end-to-end check not done** — this sandbox has no Docker, so Postgres/the full
  dev stack could not be brought up here (`apps/api` fails fast on `ECONNREFUSED 5432`
  without one). Typecheck/lint/tests are the only verification that's actually run. Run
  `run-local-dev`'s boot sequence yourself to exercise the real HTTP surface before trusting
  it end to end.
- ✅ **`code-review` (high effort) pass, 2026-09-23** over the full DS-014 diff — 10
  correctness findings, all fixed: network-detection env vars now zod-validated and fail
  toward testnet instead of raw `process.env` failing toward mainnet
  (`apps/api`/`apps/worker` env + `isMainnet()`); a TOCTOU race could open two positions for
  the same account+coin (fixed with a Postgres partial unique index,
  `auto_trades_open_account_coin_unique`, migration `0021`, plus `onConflictDoNothing`);
  `trigger_evaluations.decision` could read "opened" even when the global kill switch
  blocked every trade (kill-switch check moved before that insert); a trigger's own TWAP
  counted itself in its own parallel-flow counter-check (excluded by `externalId` now); an
  unrecognized QuickNode TWAP status was dropped with no log (now warns, matching
  `twap-watcher`'s own pattern); `PATCH /trading/risk-limits` could silently no-op and still
  answer `{ok:true}` if linking hadn't finished (now checks `.returning()` and 404s); a
  parallel TWAP with no cached mid price was tracked as a fake $0 entry instead of omitted;
  `updateRiskLimitsBodySchema` coerced money through a JS float before storage (switched to
  a validated decimal string, no float round-trip); `decryptAgentKey` could leak a raw Node
  crypto error instead of its documented `AgentKeyDecryptionError` on malformed input (now
  fully inside the `try`); and a regression from this same day's earlier "stopped vs
  terminated" fix could have collided a future unrecognized status's `externalId` with a
  real "terminated" event (fixed by keying off the raw status for unrecognized cases only).
  Also fixed: this section's own stale "no code until a plan is confirmed" framing (updated
  above), and clarified that "agent keys ... used only by a dedicated worker process" means
  signing, not generation/storage (see the constraint's own note below). 79/79 tests passing
  repo-wide (50 trading-core + 12 hyperliquid-sdk + 10 worker + 7 api).
- ✅ **Second `code-review` (high effort) pass, 2026-09-23** over the diff since the first
  pass, including `apps/web`'s new trading UI — 10 findings, all fixed: `AccountLinkCard`'s
  `linkStatus === "pending"` resume-linking UI was dead code (the earlier generic `!linked`
  check always caught it first — reordered so pending is checked first);
  `trust-score-store.ts`'s `recordEvent()` (insert + recompute) had no DB transaction, risking
  a lost-update race between concurrent TWAP status transitions for the same wallet
  corrupting the cached score/confidence/blocked that gates real position sizing (now wrapped
  in `db.transaction`); `PaperExecutionAdapter.getPosition()` returned `PositionSnapshot.size`
  as raw `sizeUsd` (dollars) instead of base-asset quantity, contradicting the field's own
  documented unit (fixed, now derived the same way `computePnl` already does internally);
  `trigger-pipeline.ts` called `hyperliquid-sdk`'s `getL2Book`/`HYPERLIQUID_REST_URLS`
  directly, contradicting `execution-adapter.ts`'s own documented promise that the trigger
  pipeline never calls an exchange SDK directly (fixed by adding an `OrderBookSource`
  interface to `packages/trading-core`, mirroring `SignalSource`/`ExecutionAdapter`, with a
  `HyperliquidOrderBookSource` implementation in `apps/worker`, injected via
  `TriggerPipelineDeps`); `trust-score-store.ts`'s `loadEvents()` did an unbounded SELECT of a
  wallet's entire event history on every call (now bounded to a 180-day window — past
  `decayHalfLifeDays`/`maturityDays`, older events contribute a negligible, bounded amount
  either way); `trigger-pipeline.ts`'s per-account loop called `hasOpenPosition`/
  `todaysRealizedLossUsd` as separate queries per account, up to 2N sequential DB round-trips
  per triggering signal (fixed with batched `openPositionsByAccount`/
  `todaysRealizedLossUsdByAccount` on `risk-guard.ts`, precomputed once before the loop);
  `active-twap-tracker.ts`'s in-memory map was only pruned on an explicit terminal-status
  `remove()`, so a dropped/unparsed WS frame leaked that entry for the worker's remaining
  uptime (fixed with a lazy eviction sweep on every `all()` call, past Hyperliquid's
  documented 7-day max TWAP duration). **Also raised as an architectural question rather than
  silently fixed** (per this file's own "no exceptions" money rule): `packages/trading-core`
  and `apps/worker/auto-trader` computed money (position sizes, tier thresholds, price
  impact, PnL, daily-loss aggregation) via JS `number`/float internally, contradicting the
  decimal-string-only rule — the same pattern already fixed once for
  `updateRiskLimitsBodySchema` in the first review pass, but not applied consistently
  elsewhere. Customer chose full migration now, not defer-and-document. Done: added
  `decimal.js` to `packages/trading-core` (`money.ts` — money crosses every public function
  boundary as a decimal string, `Decimal` is purely an internal computation detail, never
  part of a public interface); converted `position-sizing.ts`, `tier-thresholds.ts`,
  `price-impact.ts`, `parallel-flow.ts` (+ their tests) to decimal strings for every money
  field; `hyperliquid-sdk`'s `findDayNtlVlm()` now returns the raw decimal string instead of
  casting to `Number`; `apps/worker/auto-trader`'s `risk-guard.ts`, `paper-execution-adapter.ts`,
  `position-monitor.ts`, `trigger-pipeline.ts`, `index.ts`, `market-data-cache.ts`,
  `tier-config.ts` all converted. Deliberately NOT touched — not money per this file's own
  definition ("Monetary amounts (USDC, PnL, volumes)"), stays plain `number`:
  `trust-score.ts`'s scores/confidence/multipliers (dimensionless calibration parameters),
  percentages (`maxMovePct`), ratios, durations. `MidPriceCache` (apps/worker/src/twap-watcher,
  shared with twap-watcher, not modified per the "extend, don't touch old functionality" rule)
  still returns `number` — each auto-trader file converts it to `Decimal` at one clearly
  marked point, its sole blessed conversion boundary. Verified with `hyperliquid-api-reviewer`
  (2026-09-23) that no endpoint/field/subscription drift snuck in alongside the numeric-type
  change. 82/82 tests passing repo-wide (50 trading-core + 12 hyperliquid-sdk + 13 worker + 7
  api) — 3 new worker tests added for `active-twap-tracker.ts`'s eviction sweep.
- ✅ **Third `code-review` (max effort, 10-parallel-angle) pass, 2026-09-23** — run before the
  first production deploy, specifically focused on deploy safety (env/config handling,
  migration safety, anything reachable on real Hyperliquid if `AUTO_TRADER_LINKING_ENABLED`/
  `USE_REAL_AUTO_TRADER` flip on). Confirmed the diff is almost entirely additive (removed-
  behavior audit came back clean). 8 findings fixed:
  `buildApproveAgentTypedData()` (hyperliquid-sdk `signing.ts`) omitted an explicit
  `EIP712Domain` entry in its `types` object — harmless for a library like viem that
  auto-injects it, but `apps/web/src/lib/wallet.ts` calls the raw `eth_signTypedData_v4`
  JSON-RPC method directly (no viem/wagmi, by design), and a real wallet extension requires
  `EIP712Domain` explicit to hash the domain separator — the entire linking flow would have
  failed inside the user's own wallet on the very first real click-through (fixed, plus a
  test); `POST /trading/link/start` unconditionally overwrote an existing `trading_accounts`
  row via `onConflictDoUpdate` even when `linkStatus === "linked"` — a double-click, browser
  back/forward, or retry after an ambiguous network response would silently destroy the only
  copy of an already-Hyperliquid-approved agent's private key, making that agent permanently
  uncontrollable (fixed — now 409s if already linked); `trigger-pipeline.ts`'s `decision`
  label only checked `counterFlow.sizeMultiplier`, never `trustEval.sizeMultiplier`, even
  though actual position size is the product of both — silently mislabeled every
  trust-reduced-but-not-counter-flow-reduced trade as `"opened"` in `trigger_evaluations`,
  the exact table this whole calibration effort depends on (fixed); `PositionMonitor.tick()`'s
  DB select wasn't wrapped in try/catch unlike every per-trade check inside its own loop, and
  nothing downstream ever awaits/catches it — a transient DB hiccup would crash the whole
  auto-trader process, violating "each worker must not go down together" (fixed, plus a
  reentrancy lock and a `WHERE status='open'` guard on the closing UPDATE for the related,
  now-far-less-likely overlapping-tick race); `AGENT_KEY_ENCRYPTION_KEY`'s env schema checked
  only string length, not that it's actually hex — a non-hex 64-char value would pass startup
  validation and then fail with a raw, undocumented Node crypto error on the first real
  `encryptAgentKey()` call instead of failing fast at boot (fixed with a hex regex);
  `getL2Book` (hyperliquid-sdk) had no fetch timeout despite now being called synchronously
  mid-trigger-evaluation past every cheaper gate — an unbounded hang would silently mean that
  signal's `trigger_evaluations` row (documented as "exactly one row per signal") never gets
  written (fixed with a 5s `AbortSignal.timeout`); `trust-score-store.ts`'s `loadEvents()`
  history-window cutoff was anchored to wall-clock `Date.now()` while decay/confidence math
  used the caller's own `now` (the triggering signal's `occurredAt`) — a worker restart
  catching up on a backlog would window events inconsistently with the evaluation's own
  stated "now" (fixed — cutoff now threads the same `now` through); dead code —
  `RiskGuard.todaysRealizedLossUsd()`/`hasOpenPosition()` (the pre-batching singular methods)
  had zero remaining callers after the second review pass introduced their batch replacements,
  left to rot side by side (removed).
  **Also raised as a real correctness bug needing a decision, not silently fixed:**
  `computeNetFlow()` (parallel-flow.ts, spec §7) only counted an `ActiveTwap` whose
  `activatedAt` fell inside the last `windowMinutes` — contradicting spec §7's own worked
  example (10 sixty-minute buy-TWAPs started 12-20 minutes ago, still executing, must count
  as pressure) and locked in by a test asserting the wrong behavior as intended. Customer
  chose: fix now, count every currently-active TWAP with no time-based window at all (the
  tracker already only holds non-terminal TWAPs by construction, so being "active" already
  means "still running" — a second time-window filter on top was redundant/wrong, not a
  second layer of real protection). Done: `computeNetFlow(activeTwaps, coin)` dropped its
  `now`/`windowMinutes` parameters entirely; `PARALLEL_FLOW_WINDOW_MINUTES` env var and
  `TriggerPipelineDeps.parallelFlowWindowMinutes` removed as now-dead config;
  `active-twap-tracker.ts`'s restart-recovery doc comment corrected (no longer "self-healing
  within a fixed window" — a TWAP active before a restart now stays invisible for the rest of
  its own run, up to Hyperliquid's 7-day max, not a bounded window); test rewritten to assert
  the corrected behavior. Not touched by this fix, deferred as Phase-B-design gaps rather than
  live bugs today (no code path sets `tradingAccounts.mode = "live"` yet): `PositionMonitor`
  closes trades by flipping the DB row directly rather than through
  `ExecutionAdapter.closePosition()` (zero call sites for `closePosition`/`getPosition`
  anywhere), and only one global `ExecutionAdapter` instance is wired in regardless of
  per-account `mode` — both mean `execution-adapter.ts`'s own claim that promoting an account
  from paper to live is "a matter of swapping which adapter instance it's wired to, not a
  pipeline rewrite" is not fully true yet; revisit when Phase B is actually planned. Also
  deferred: `apps/web`'s `useTrades`/`useLeaderboard` polling hooks are structurally identical
  hand-rolled duplicates of the pre-existing `useSubscription` pattern (a shared
  `usePolledResource` would collapse them) — cosmetic, not a correctness issue.
  83/83 tests passing repo-wide (50 trading-core + 13 hyperliquid-sdk + 13 worker + 7 api).
- ✅ **First production deploy, 2026-09-23/24** — merged to `main`, deployed via
  `scripts/deploy.sh`. Two real gaps found and fixed only by actually deploying (neither
  caught by typecheck/lint/tests, since they're deploy-topology/dependency-resolution
  issues, not application logic):
  1. `docker-compose.prod.yml` had no `auto-trader` service at all — every other worker
     runs as its own container per CLAUDE.md's "each worker independent" rule, but the new
     worker was simply never added to prod's compose file, so the code would have shipped
     with no running process for it. Fixed by adding the service (mirroring the existing
     `twap-watcher` pattern, `HEARTBEAT_PORT=9108`) and registering it with the Telegram
     health-watchdog's port map (`apps/bot/src/modules/health-watchdog/index.ts`) — gated on
     the same deploy that enables `USE_REAL_AUTO_TRADER`, so it never reports the
     intentionally-idle pre-enable state as a false alarm (the exact DS-010 failure mode).
  2. `apps/worker/package.json` had a stray **direct** dependency on `@noble/hashes@^2.3.0`
     that apps/worker never itself imports (only `packages/hyperliquid-sdk` does, correctly
     declaring `^1.6.1`). Because tsup bundles `@hypertracker/*` source directly into
     apps/worker's own dist output (`noExternal`), the bundled `agent-wallet.ts` code's
     `@noble/hashes/sha3` import resolved at runtime against apps/worker's OWN
     `node_modules` — which had v2.3.0 installed (from the stray dependency), whose
     restructured exports no longer expose a `./sha3` subpath. Result: **6 of 8 worker
     containers crash-looped in production for ~10 hours** (every worker whose bundle
     transitively includes hyperliquid-sdk) between the deploy landing and this being caught
     — `deposit-watcher`/`subscription-watcher`/`api` were unaffected (don't pull in that
     chunk), `auto-trader`/`wallet-watcher`/`market-watcher`/`twap-watcher`/
     `coin-registry-sync`/`common-wallet-tracker` were down. Fixed by removing the unused
     dependency entirely; redeployed and confirmed all containers healthy, no crash-loop.
     **Lesson for future dependency changes to `apps/worker` or `packages/hyperliquid-sdk`:
     a clean local `pnpm --filter @hypertracker/worker typecheck` does NOT catch a wrong
     transitive version winning package-manager resolution — only an actual `pnpm --filter
@hypertracker/worker build` + running the built output (or a real deploy) does.**
     After both fixes: full stack healthy, `auto-trader` connected to the QuickNode TWAP
     stream (`network: "testnet"`, `HYPERLIQUID_NETWORK` unset in prod `.env`, defaults safe).
     `USE_REAL_AUTO_TRADER=true` enabled in prod (market-observation/Trust-Score pipeline only
     — no linked accounts possible, `AUTO_TRADER_LINKING_ENABLED` stays `false` pending the
     `signatureChainId` testnet confirmation above). `trigger_evaluations`/`trust_scores` now
     accumulating real data; no web UI for `trigger_evaluations` (DB-only, see
     `docker exec hypertracker-postgres-1 psql -U hypertracker -d hypertracker` on the VM).
- ✅ **Wallet-linking testnet round-trip, 2026-09-24** — a real user linked a real wallet
  through `apps/web`'s Auto-trading page against Hyperliquid testnet, surfacing three more
  real bugs only a live wallet+browser test could catch:
  1. `buildApproveAgentTypedData()`'s `types` object was missing an explicit `EIP712Domain`
     entry — a real wallet's raw `eth_signTypedData_v4` (this project deliberately doesn't
     use viem/wagmi, which auto-injects it) throws without it. Fixed, with a test.
  2. MetaMask rejects `eth_signTypedData_v4` outright if `domain.chainId` doesn't match the
     wallet's currently-active-for-this-site network — confirmed via a real RPC error
     (`-32603 "Provided chainId ... must match the active chainId ..."`), and this can differ
     from the wallet's global network selector, so "ask the user to switch manually" isn't
     reliable. Fixed by having `apps/web/src/lib/wallet.ts`'s `signTypedData()` call
     `wallet_switchEthereumChain` (falling back to `wallet_addEthereumChain` with Arbitrum
     Sepolia params on error 4902) before signing. **This test round-trip is also what
     RESOLVED the signatureChainId OPEN VERIFICATION ITEM** — see
     `packages/hyperliquid-sdk/src/signing.ts`'s own doc comment: Hyperliquid's testnet
     `/exchange` accepted the signature and rejected the call only on an unrelated business
     rule ("Must deposit before performing actions" — real, expected for a never-funded
     testnet wallet; hyperliquid-docs MCP's testnet-faucet page: the faucet itself requires a
     mainnet deposit on the same address first), never on signature/domain verification.
  3. That rejection was relayed to the browser as a raw `502` with Hyperliquid's own wording
     — reads as an infrastructure failure, not the expected/actionable state it is. Changed
     to `422` with a plain-language message for this specific, verified rejection reason
     (falls back to relaying Hyperliquid's own text for anything else, not guessing).
     **Separately — a real incident this same round of testing caused, unrelated to the fixes
     above:** setting `HYPERLIQUID_NETWORK=testnet` in the shared root `.env` (to gate the
     linking test) leaked into every OTHER service reading the same `env_file` —
     `market-watcher`/`wallet-watcher`/`common-wallet-tracker`/`twap-watcher` silently switched
     from real mainnet Hyperliquid data to testnet for several hours, breaking real production
     notifications for actual users (confirmed: `market-watcher`'s WS was connecting to
     `wss://api.hyperliquid-testnet.xyz/ws` instead of mainnet). Fixed by moving
     `HYPERLIQUID_NETWORK=testnet` to explicit per-service `environment:` overrides in
     `docker-compose.prod.yml` on only `api` and `auto-trader` (the two services that actually
     need it right now), removing it from the shared `.env` entirely; every other service's own
     code already defaults to mainnet once the var is unset again. **Lesson: the shared root
     `.env` (`env_file: .env` in every service block) is blast-radius-for-the-whole-stack, not
     scoped to whichever feature a variable was added for — any new env var meant for one
     service only belongs in that service's own `environment:` override, never the shared file,
     unless it's genuinely meant for everyone.**
- ✅ **First full paper-trade lifecycle, 2026-09-24** — right after the mainnet market-data
  fix above went live: a real DOGE sell-TWAP signal ($225,597, wallet
  `0xccf3fff396a14d55d93366f870c007425e9f2a75`) cleared the Tier A threshold ($116,928,
  computed from real mainnet `dayNtlVlm`), evaluated at a near-neutral trust score (0.0066 —
  a low-confidence, presumably new wallet), sized to the account's `baseSizeUsd` ($50),
  opened as `auto_trades` row 1, and was closed by `position-monitor.ts` on a stop-loss hit
  ~8 seconds later (realized PnL -$0.03, paper only). First real end-to-end confirmation of
  the whole pipeline (signal → tier threshold → trust score → price-impact SL/TP → position
  sizing → paper open → SL/TP monitoring → close) working together, not just unit-tested in
  isolation. **Calibration observation, not a bug** (formulas are still explicitly
  unconfirmed placeholders per this section's own framing): an 8-second SL hit on DOGE is
  fast — worth watching whether this repeats once more trades accumulate, as a signal the
  price-impact-derived stop might be too tight relative to normal short-term noise for
  liquid coins.
- ⚠️ **Paper-model validity audit, 2026-09-25 (78 closed paper trades, ~1 day)** — headline
  paper PnL (+$8.99, 46 TP / 32 SL) is **NOT trustworthy as a calibration signal yet**, found
  by inspecting the rows rather than the totals: (1) **28 of 78 trades (36%) were malformed at
  birth** — stop-loss on the wrong side of the recorded entry (e.g. XMR sell: entry 571.745,
  SL 570.315), 5 more had TP on the wrong side. 18 of those closed as instant `closed_sl` at
  ~$0 PnL (noise that pollutes the win-rate), 10 closed `closed_tp` (+$2.21, partly free
  wins). Cause: the paper fill price comes from `MidPriceCache` (REST `allMids`, polled, can
  lag) while SL/TP are anchored to the FRESH `l2Book` best level in `trigger-pipeline.ts` —
  two different price references; and when the predicted impact is ~0 (TWAP notional fits in
  the first book level) `maxMovePct=0` collapses SL=TP=touch price, which is on the wrong side
  of a mid-priced entry. (2) **Fills are at mid with no spread, slippage or fees** — optimistic
  for every trade, badly so on thin coins (SAGA buy: derived best ask ≈1.8% above the mid it
  was "filled" at). (3) **PnL is concentrated**: SAGA+AZTEC+CC = 6 trades = +$5.65 of the +$9.5 TP total, all wide-spread small caps. (4) buys 53 trades +$8.21 vs sells 25 trades +$0.79 — one-day sample, market-drift confounder. Well-formed subset only (50 trades): 36
  TP / 14 SL, +$6.80. **Before using paper results to decide anything about Phase B:** anchor
  SL/TP to the actual fill price (single reference), skip/flag trades whose SL/TP geometry is
  invalid or zero-width, fill at the touch (ask for buy / bid for sell) with a fee model, and
  report PnL excluding thin-coin outliers. **FIXED 2026-09-25** (customer: "чини модель"):
  entry, SL and TP now share ONE price reference — the touch (ask for buy / bid for sell) from
  the fresh `l2Book`, passed to the adapter as `OpenPositionRequest.referencePx`; the paper
  adapter fills exactly there (spread paid by construction, no more cached-mid fills);
  `validateBracket()` (`trading-core/paper-model.ts`) makes the pipeline SKIP — logged as
  `skipReason: "invalid_bracket:<zero_width_bracket|stop_wrong_side|take_profit_wrong_side|
stop_inside_spread>"` — any signal whose bracket is zero-width, on the wrong side, or has a
  stop closer than `MIN_STOP_DISTANCE_SPREADS` (=2, calibration placeholder) full spreads;
  exits go through `computePaperExit()`: TP fills at its own level (maker fee), SL at the worse
  of its level and the observed mid (taker fee), entry pays taker, and `realized_pnl_usd` is
  now NET of both fees (Hyperliquid base perps tier: taker 0.045% / maker 0.015%, verified
  against the hyperliquid-docs MCP + hyperliquid-api-reviewer 2026-09-25). Book sides are now
  sorted explicitly (best-first ordering is undocumented). **Data cut-over:** every
  `auto_trades` row opened BEFORE this deploy used the old, optimistic, gross-of-fee model —
  filter calibration analysis to rows opened after the cut-over (record the deploy time
  below); expect FEWER trades (invalid brackets are skipped, notably liquid coins whose
  predicted impact is ~0). Residual known optimism: exit detection compares mids to levels
  (up to half a spread early) and the spread is not charged again on exit.

- ✅ **Per-account "ignored coins", 2026-09-26** (customer request, plan confirmed first): tag
  picker on the Auto-trading page's risk form (reuses the feed's `CoinFilter`); migration
  `0022` adds `risk_limits.ignored_coins text[] NOT NULL DEFAULT '{}'` (additive; nothing is
  ignored until the user chooses, BTC/ETH/SOL are one-tap suggestions, not defaults). Extends
  the existing `GET/PATCH /trading/risk-limits` (no new settings route) + a new
  `GET /trading/coins` (top-250 registry UNION every coin the auto-trader has evaluated —
  deliberately not the existing subscription-gated, top-250-only `/coins`). Enforced ONLY in
  `trigger-pipeline.ts`'s per-account fan-out (`account.ignoredCoins.includes(signal.coin)`):
  the account-independent signal is still evaluated and logged to `trigger_evaluations`
  (calibration data stays complete) and already-open positions keep running to their own
  TP/SL — same soft-stop semantics as `tradingEnabled`. Symbols are exact/case-sensitive
  (`kPEPE` != `KPEPE`), format-validated only, max 100, deduped. Motivation: on liquid majors
  the predicted-impact brackets are a few bps, below the ~6 bps round-trip fee (see the
  2026-09-25 audit above). The fee-aware automatic skip (TP distance < fees) is a separate,
  still-open decision.

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
