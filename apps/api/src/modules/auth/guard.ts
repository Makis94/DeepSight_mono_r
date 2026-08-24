import { activeSessionCondition, sessions, type Database } from "@hypertracker/db";
import type { Session } from "@hypertracker/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { verifySessionToken } from "./jwt.js";

// Standalone site (apps/web outside a Mini App) authenticates via this httpOnly cookie —
// never readable by JS, so an XSS payload or a "copy from DevTools > Local Storage" can't
// exfiltrate it the way a localStorage-held bearer token could. The Mini App context
// deliberately does NOT use this: it stays on the pre-existing Authorization: Bearer header
// with the token held in memory only (see apps/web's lib/mini-app-session.ts) — Telegram's
// Mini App WebView/iframe embedding makes cookie persistence unreliable across platforms, and
// Mini App auth already re-authenticates silently from initData on every fresh open anyway,
// so it never needed persistent storage in the first place.
export const SESSION_COOKIE = "session";

// Exported for /auth/logout (auth/routes.ts) and the realtime WS handshake
// (realtime/routes.ts) — both need the same "header, else cookie" precedence this guard uses,
// and duplicating the logic risks the two silently drifting apart.
export function extractToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  const fromHeader = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  return fromHeader ?? request.cookies[SESSION_COOKIE];
}

/**
 * Shared REST auth guard — extracts and verifies the same session token the realtime
 * WS gateway checks (see realtime/routes.ts): an `Authorization: Bearer` header (Mini App)
 * or the `session` cookie (standalone site). Sends the 401 itself and returns undefined so
 * callers can `if (!session) return;` and stop.
 *
 * A valid JWT signature alone isn't enough: the sessions-table lookup below is what actually
 * makes "one active session per telegram_id" enforceable — a token that's been superseded by
 * a newer login (or explicitly signed out) still verifies fine cryptographically until its
 * own exp, so revocation has to be checked out-of-band. See packages/db's sessions.ts and
 * this project's session-revocation plan.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
): Promise<Session | undefined> {
  const token = extractToken(request);
  if (!token) {
    await reply.status(401).send({ error: "missing session token" });
    return undefined;
  }

  let verified;
  try {
    verified = await verifySessionToken(token, env.JWT_SECRET);
  } catch {
    await reply.status(401).send({ error: "invalid session token" });
    return undefined;
  }

  const [row] = await db
    .select({ jti: sessions.jti })
    .from(sessions)
    .where(and(eq(sessions.jti, verified.jti), activeSessionCondition()))
    .limit(1);
  if (!row) {
    await reply.status(401).send({ error: "invalid session token" });
    return undefined;
  }

  return verified.session;
}
