import { sessions, type Database } from "@hypertracker/db";
import type { Session } from "@hypertracker/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { SESSION_TTL_MS, signSession } from "./jwt.js";

/**
 * Enforces "one active session per telegram_id": revokes whatever session this user already
 * had (if any), records the new one, and signs a token bound to it. Both auth routes
 * (/auth/mini-app, /auth/login-widget) go through this instead of calling signSession
 * directly, so neither can accidentally leave two live sessions for the same user.
 *
 * pg_advisory_xact_lock serializes this per telegramId: without it, two logins landing at the
 * genuinely the same instant (e.g. the standalone site and the Mini App racing on first open)
 * could each see the other's not-yet-committed revoke as "no active session to revoke", then
 * both try to insert an active row — the partial unique index on sessions
 * (packages/db/src/schema/sessions.ts) would reject the second insert outright rather than
 * silently allowing two live sessions, but that surfaces as a raw 500 instead of just working.
 * The lock is transaction-scoped — released automatically on commit or rollback, no separate
 * unlock call needed.
 */
export async function issueSession(
  db: Database,
  session: Session,
  jwtSecret: string,
): Promise<string> {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${session.telegramId})`);
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.telegramId, session.telegramId), isNull(sessions.revokedAt)));
    await tx.insert(sessions).values({ jti, telegramId: session.telegramId, expiresAt });
  });

  return signSession(session, jti, jwtSecret);
}

/** Used by POST /auth/logout — makes "sign out" actually kill the token server-side. */
export async function revokeSession(db: Database, jti: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.jti, jti), isNull(sessions.revokedAt)));
}
