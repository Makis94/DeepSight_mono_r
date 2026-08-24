import { sessionSchema, type Session } from "@hypertracker/shared";
import { jwtVerify, SignJWT } from "jose";

const SESSION_TTL = "30d";
// Kept in sync with SESSION_TTL above (jose only exposes the TTL as a signed relative
// duration on the token itself, not back out to the caller) — used to compute the sessions
// row's expiresAt at issue time. See auth/routes.ts.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function signSession(session: Session, jti: string, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .setJti(jti)
    .sign(key);
}

export interface VerifiedSession {
  session: Session;
  jti: string;
}

export async function verifySessionToken(token: string, secret: string): Promise<VerifiedSession> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  if (typeof payload.jti !== "string") {
    // Pre-migration tokens (signed before the sessions table existed) have no jti at all —
    // treated the same as "invalid", forcing exactly one re-login. See CLAUDE.md rollout note
    // in the sessions-table plan.
    throw new Error("session token missing jti");
  }
  return { session: sessionSchema.parse(payload), jti: payload.jti };
}
