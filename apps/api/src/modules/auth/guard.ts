import { activeSessionCondition, sessions, type Database } from "@hypertracker/db";
import type { Session } from "@hypertracker/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { verifySessionToken } from "./jwt.js";

/**
 * Shared REST auth guard — extracts and verifies the same session token the realtime
 * WS gateway checks (see realtime/routes.ts), just carried via `Authorization: Bearer`
 * instead of a query param. Sends the 401 itself and returns undefined so callers can
 * `if (!session) return;` and stop.
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
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
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
