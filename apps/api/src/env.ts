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
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
