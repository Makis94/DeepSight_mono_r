import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Telegram chat id the health-watchdog pings when a worker goes unhealthy or the market
  // TWAP feed stalls. Unset ⇒ the watchdog stays idle (no alerts). Usually the operator's
  // own user id or a private ops group.
  ADMIN_TELEGRAM_ID: z.coerce.number().int().positive().optional(),
  // How long with no new market_twap row before the health-watchdog alerts.
  TWAP_STALE_MINUTES: z.coerce.number().int().positive().default(45),
  NOWPAYMENTS_API_KEY: z.string().min(1),
  NOWPAYMENTS_BASE_URL: z.string().url().default("https://api.nowpayments.io"),
  // apps/api's publicly reachable URL — the bot's /subscribe command points NowPayments'
  // ipn_callback_url at apps/api's webhook route, not at itself.
  PUBLIC_API_URL: z.string().url(),
  // apps/web's publicly reachable URL — used as the success_url/cancel_url when creating a
  // NowPayments invoice from /subscribe, so the hosted payment page redirects the customer
  // back to our site instead of stranding them on NowPayments' own generic success page.
  PUBLIC_WEB_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
