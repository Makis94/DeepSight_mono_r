import { subscriptions, users, type Database } from "@hypertracker/db";
import {
  adminLoginBodySchema,
  SUBSCRIPTION_PERIOD_DAYS,
  type AdminUserRow,
} from "@hypertracker/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../env.js";
import { verifyAdminCredentials } from "./credentials.js";
import { ADMIN_SESSION_COOKIE, requireAdminSession } from "./guard.js";
import { signAdminSession } from "./jwt.js";
import {
  clearLoginAttempts,
  isLoginRateLimited,
  recordFailedLoginAttempt,
} from "./login-rate-limit.js";

// Same convention as apps/api/src/modules/subscription/routes.ts's daysFromNow — duplicated
// rather than imported since that module also owns NowPayments-specific setup this route
// has no business depending on.
function daysFromNow(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

const isProduction = env.NODE_ENV === "production";
// Cookie only ever needs to travel to admin routes — keeps it out of every user-facing
// request, and lets /admin/login set it before an admin session technically "exists".
const ADMIN_COOKIE_PATH = "/admin";

// Hand-rolled instead of reply.setCookie()/clearCookie(): @fastify/cookie@11.1.2's
// setCookie writes the header from inside its own onSend hook, and on this stack that
// path reliably leaves the response never flushed to the socket (verified in isolation —
// the exact same header set directly via reply.header(), including from a hand-written
// onSend hook, sends instantly every time; only @fastify/cookie's own setCookie/onSend
// path hangs). @fastify/cookie stays registered for request-side parsing (request.cookies
// in guard.ts), which isn't affected — only the write side is bypassed here. ADMIN_JWT is
// base64url (jose's SignJWT), so no attribute-value escaping is needed.
function adminSessionCookieHeader(token: string): string {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${token}`,
    `Path=${ADMIN_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${60 * 60 * 12}`,
  ];
  if (isProduction) attrs.push("Secure");
  return attrs.join("; ");
}

function clearedAdminSessionCookieHeader(): string {
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=`,
    `Path=${ADMIN_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isProduction) attrs.push("Secure");
  return attrs.join("; ");
}

export function adminRoutes(app: FastifyInstance, db: Database): void {
  app.post("/admin/login", async (request, reply) => {
    if (isLoginRateLimited(request.ip)) {
      await reply.status(429).send({ error: "too many login attempts, try again later" });
      return;
    }

    const body = adminLoginBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid request body" });
      return;
    }

    const valid = await verifyAdminCredentials(body.data.username, body.data.password, {
      username: env.ADMIN_USERNAME,
      passwordHash: env.ADMIN_PASSWORD_HASH,
    });
    if (!valid) {
      recordFailedLoginAttempt(request.ip);
      await reply.status(401).send({ error: "invalid credentials" });
      return;
    }
    clearLoginAttempts(request.ip);

    const token = await signAdminSession(
      { role: "admin", username: body.data.username },
      env.ADMIN_JWT_SECRET,
    );
    await reply.header("set-cookie", adminSessionCookieHeader(token)).send({ ok: true });
  });

  app.post("/admin/logout", async (_request, reply) => {
    await reply.header("set-cookie", clearedAdminSessionCookieHeader()).send({ ok: true });
  });

  app.get("/admin/users", async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;

    const rows = await db
      .select({
        telegramId: users.telegramId,
        username: users.username,
        firstName: users.firstName,
        createdAt: users.createdAt,
        subscriptionStatus: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.telegramId, users.telegramId))
      .orderBy(desc(users.createdAt));

    // A user who never started a trial/payment has no subscriptions row at all — reports as
    // "expired", mirroring apps/api's own toSubscriptionResponse (subscription/routes.ts).
    const result: AdminUserRow[] = rows.map((row) => ({
      telegramId: row.telegramId,
      username: row.username,
      firstName: row.firstName,
      createdAt: row.createdAt.toISOString(),
      subscriptionStatus: row.subscriptionStatus ?? "expired",
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    }));

    return { users: result };
  });

  // Manual grant for testers/support — sets the standard plan the same way a finished
  // NowPayments payment does (see subscription/routes.ts's webhook handler), just without a
  // payment behind it. No trial_claims interaction: this always grants "active", never
  // "trial", so it can't be used to bypass the one-trial-per-user abuse guard.
  app.post<{ Params: { telegramId: string } }>(
    "/admin/users/:telegramId/grant-subscription",
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;

      const telegramId = Number(request.params.telegramId);
      if (!Number.isInteger(telegramId) || telegramId <= 0) {
        await reply.status(400).send({ error: "invalid telegramId" });
        return;
      }

      const [user] = await db
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      if (!user) {
        await reply.status(404).send({ error: "user not found" });
        return;
      }

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.telegramId, telegramId))
        .limit(1);
      const extendFrom =
        sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
          ? sub.currentPeriodEnd
          : new Date();
      const currentPeriodEnd = daysFromNow(SUBSCRIPTION_PERIOD_DAYS, extendFrom);

      await db
        .insert(subscriptions)
        .values({ telegramId, status: "active", currentPeriodEnd })
        .onConflictDoUpdate({
          target: subscriptions.telegramId,
          set: { status: "active", currentPeriodEnd, updatedAt: new Date() },
        });

      const [row] = await db
        .select({
          telegramId: users.telegramId,
          username: users.username,
          firstName: users.firstName,
          createdAt: users.createdAt,
          subscriptionStatus: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.telegramId, users.telegramId))
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      if (!row) {
        // Can't happen: the users-row existence check above already passed, and the
        // subscriptions upsert just above guarantees a matching subscriptions row too.
        await reply.status(500).send({ error: "failed to load updated user" });
        return;
      }

      const updated: AdminUserRow = {
        telegramId: row.telegramId,
        username: row.username,
        firstName: row.firstName,
        createdAt: row.createdAt.toISOString(),
        subscriptionStatus: row.subscriptionStatus ?? "expired",
        trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      };

      return { user: updated };
    },
  );
}
