import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Same bot token the Telegram bot uses — both auth verification schemes derive their
  // secret key from it, so apps/api needs it even though it never talks to Telegram itself.
  BOT_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET should be at least 32 characters"),
  NOWPAYMENTS_API_KEY: z.string().min(1),
  // Separate credential from the API key — only used to verify the x-nowpayments-sig header
  // on incoming IPN callbacks (see verifyNowPaymentsIpnSignature in packages/shared).
  NOWPAYMENTS_IPN_SECRET: z.string().min(1),
  NOWPAYMENTS_BASE_URL: z.string().url().default("https://api.nowpayments.io"),
  // Publicly reachable URL for this apps/api instance, used as the ipn_callback_url when
  // creating invoices — NowPayments needs to be able to POST back to it, so this can't be
  // localhost outside of tunneled local dev (see run-local-dev skill).
  PUBLIC_API_URL: z.string().url(),
  // apps/web's publicly reachable URL — used as the success_url/cancel_url when creating a
  // NowPayments invoice, so the hosted payment page redirects the customer back to our site
  // instead of stranding them on NowPayments' own generic "Paid successfully" page.
  PUBLIC_WEB_URL: z.string().url(),
  // Single-operator admin panel (apps/admin) — deliberately separate credential from the
  // unified Telegram identity system (see CLAUDE.md), since the admin isn't a product user.
  ADMIN_USERNAME: z.string().min(1),
  // bcrypt hash only, never the plaintext password — generate with
  // `pnpm --filter @hypertracker/api hash-admin-password <password>`.
  ADMIN_PASSWORD_HASH: z.string().min(1),
  ADMIN_JWT_SECRET: z.string().min(32, "ADMIN_JWT_SECRET should be at least 32 characters"),
  // Exact origin apps/admin is served from — admin auth uses a cookie, so CORS for it must
  // allow credentials, which requires a specific allowlisted origin rather than the
  // reflect-any-origin default the rest of apps/api's CORS uses.
  ADMIN_ORIGIN: z.string().url(),
  // Same "off by default, explicit opt-in" shape as apps/worker's USE_REAL_* flags — the
  // trading routes create real agent keypairs and submit a real signed approveAgent action
  // to Hyperliquid. See CLAUDE.md's TWAP auto-trading section: the signatureChainId this
  // relies on was confirmed correct via a real testnet round-trip on 2026-09-24 (see
  // packages/hyperliquid-sdk/src/signing.ts) — still keep this off against mainnet until
  // that's separately decided, the chainId confirmation only covered testnet.
  AUTO_TRADER_LINKING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // 32-byte AES-256-GCM key, hex-encoded (64 hex chars) — encrypts trading_accounts.
  // agentPrivateKeyEncrypted at rest (see modules/trading/crypto.ts). Required only when
  // AUTO_TRADER_LINKING_ENABLED is true (checked at server startup, not schema-level, so
  // deployments that never enable trading don't need to provision it). Generate with
  // `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  // Validates it's actually 64 hex chars, not just 64 characters — code-review (2026-09-23)
  // caught that .length(64) alone let a non-hex string (copy-paste artifact, password-manager
  // output) pass validation at boot; Buffer.from(keyHex, "hex") then silently truncates at the
  // first invalid pair instead of throwing, so the first real encryptAgentKey() call (no
  // try/catch around it) would fail with a raw, undocumented Node crypto "Invalid key length"
  // error instead of failing fast here with a clear message.
  AGENT_KEY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "AGENT_KEY_ENCRYPTION_KEY must be exactly 64 hex characters")
    .optional(),
  // Validated (not read raw off process.env) and defaults to the SAFER side — code-review
  // (2026-09-23) caught that the raw-process.env pattern used elsewhere in this codebase
  // (e.g. market-twaps/routes.ts) is fine for read-only info requests, but this same
  // "anything other than the literal string 'testnet' means mainnet" logic here would feed
  // buildApproveAgentAction/submitSignedAction — a REAL write to Hyperliquid — so a typo or
  // unset var must fail toward testnet, never silently toward mainnet.
  HYPERLIQUID_NETWORK: z.enum(["mainnet", "testnet"]).default("testnet"),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
