import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuthVerificationError } from "./errors.js";
import type { Session } from "./session.js";

const telegramWebAppUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  photo_url: z.string().optional(),
});

export interface VerifyMiniAppInitDataOptions {
  /** Reject initData older than this many seconds. Default 24h. */
  maxAgeSeconds?: number;
}

// Telegram Mini App initData verification.
// source: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// secret_key = HMAC_SHA256(key="WebAppData", message=botToken) — note this is a DIFFERENT
// scheme than the Login Widget's (secret_key = SHA256(botToken)), even though both use the
// same bot token.
export function verifyMiniAppInitData(
  initData: string,
  botToken: string,
  options: VerifyMiniAppInitDataOptions = {},
): Session {
  const maxAgeSeconds = options.maxAgeSeconds ?? 60 * 60 * 24;
  const params = new URLSearchParams(initData);

  const receivedHash = params.get("hash");
  if (!receivedHash) {
    throw new AuthVerificationError("initData is missing hash");
  }
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expectedBuf = Buffer.from(expectedHash, "hex");
  const receivedBuf = Buffer.from(receivedHash, "hex");
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new AuthVerificationError("initData signature mismatch");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new AuthVerificationError("initData is expired");
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    throw new AuthVerificationError("initData is missing user");
  }

  const userParseResult = telegramWebAppUserSchema.safeParse(JSON.parse(userRaw) as unknown);
  if (!userParseResult.success) {
    throw new AuthVerificationError("initData user payload is malformed");
  }
  const user = userParseResult.data;

  return {
    telegramId: user.id,
    authMethod: "mini_app",
    ...(user.username !== undefined ? { username: user.username } : {}),
    ...(user.first_name !== undefined ? { firstName: user.first_name } : {}),
    ...(user.photo_url !== undefined ? { photoUrl: user.photo_url } : {}),
  };
}
