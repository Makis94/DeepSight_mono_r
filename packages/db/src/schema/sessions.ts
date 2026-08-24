import { and, gt, isNull, sql, type SQL } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

// One row per issued session token (jti = the JWT's standard "jti" claim, generated at issue
// time in apps/api's auth/jwt.ts). Exists purely to make a token revocable — a bare JWT's
// signature stays "valid" until its own exp regardless of what happens server-side, so
// anything that needs "kill this token right now" (a new login elsewhere superseding it, an
// explicit /auth/logout) has to live here instead. Checked on every authenticated request by
// apps/api's auth/guard.ts and the realtime WS handshake (realtime/routes.ts).
export const sessions = pgTable(
  "sessions",
  {
    jti: text("jti").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" })
      .notNull()
      .references(() => users.telegramId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Mirrors the JWT's own exp — checked directly so an expired row can't be mistaken for a
    // live session without re-decoding the token.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // NULL = still the active session for this telegramId. Set the instant a newer login
    // supersedes it, or an explicit /auth/logout call.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    // One-active-session-per-user policy, enforced at the DB level as a backstop against a
    // race between two concurrent logins for the same telegramId (not just app-level
    // sequencing in auth/routes.ts).
    telegramIdActiveUnique: uniqueIndex("sessions_telegram_id_active_unique")
      .on(table.telegramId)
      .where(sql`${table.revokedAt} is null`),
  }),
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

// Single source of truth for "is this jti still good" — combine with eq(sessions.jti, ...) in
// a WHERE clause. Both the REST guard and the realtime WS handshake must use this exact
// condition, same reasoning as activeSubscriptionCondition in subscriptions.ts.
export function activeSessionCondition(now: Date = new Date()): SQL {
  const condition = and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now));
  if (!condition) {
    throw new Error("unreachable: activeSessionCondition built from two fixed clauses");
  }
  return condition;
}
