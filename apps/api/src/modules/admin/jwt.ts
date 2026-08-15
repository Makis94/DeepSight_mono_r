import { adminSessionSchema, type AdminSession } from "@hypertracker/shared";
import { jwtVerify, SignJWT } from "jose";

// Short-lived relative to the user-facing session's 30d TTL (see ../auth/jwt.ts) — this
// token gates write access to every user's subscription status, so it's worth re-logging-in
// more often.
const ADMIN_SESSION_TTL = "12h";

export async function signAdminSession(session: AdminSession, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ADMIN_SESSION_TTL)
    .sign(key);
}

export async function verifyAdminSessionToken(
  token: string,
  secret: string,
): Promise<AdminSession> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return adminSessionSchema.parse(payload);
}
