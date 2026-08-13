import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthVerificationError } from "./errors.js";
import type { Session } from "./session.js";

// Fields as posted by the Telegram Login Widget callback (all strings — the widget
// serializes numbers as decimal strings too).
const loginWidgetPayloadSchema = z.object({
  id: z.string(),
  first_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.string(),
  hash: z.string(),
});

export interface VerifyLoginWidgetOptions {
  /** Reject payloads older than this many seconds. Default 24h. */
  maxAgeSeconds?: number;
}

// Telegram Login Widget verification.
// source: https://core.telegram.org/widgets/login#checking-authorization
// secret_key = SHA256(botToken) — a plain hash, NOT the HMAC(key="WebAppData", ...) scheme
// the Mini App's initData uses, even though both derive from the same bot token.
export function verifyLoginWidget(
  payload: Record<string, string>,
  botToken: string,
  options: VerifyLoginWidgetOptions = {},
): Session {
  const maxAgeSeconds = options.maxAgeSeconds ?? 60 * 60 * 24;

  const parseResult = loginWidgetPayloadSchema.safeParse(payload);
  if (!parseResult.success) {
    throw new AuthVerificationError("login widget payload is malformed");
  }
  const fields = parseResult.data;

  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== "hash")
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${payload[key]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expectedBuf = Buffer.from(expectedHash, "hex");
  const receivedBuf = Buffer.from(fields.hash, "hex");
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new AuthVerificationError("login widget signature mismatch");
  }

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new AuthVerificationError("login widget payload is expired");
  }

  const telegramId = Number(fields.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    throw new AuthVerificationError("login widget id is invalid");
  }

  return {
    telegramId,
    authMethod: "login_widget",
    ...(fields.username !== undefined ? { username: fields.username } : {}),
    ...(fields.first_name !== undefined ? { firstName: fields.first_name } : {}),
    ...(fields.photo_url !== undefined ? { photoUrl: fields.photo_url } : {}),
  };
}
