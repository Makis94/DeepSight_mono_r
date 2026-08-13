import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NOWPAYMENTS_API_KEY: z.string().min(1),
  NOWPAYMENTS_BASE_URL: z.string().url().default("https://api.nowpayments.io"),
  // apps/api's publicly reachable URL — the bot's /subscribe command points NowPayments'
  // ipn_callback_url at apps/api's webhook route, not at itself.
  PUBLIC_API_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
