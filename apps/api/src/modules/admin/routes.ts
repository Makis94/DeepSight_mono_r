import { subscriptions, users, type Database } from "@hypertracker/db";
import { adminLoginBodySchema, type AdminUserRow } from "@hypertracker/shared";
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

const isProduction = env.NODE_ENV === "production";
// Cookie only ever needs to travel to admin routes — keeps it out of every user-facing
// request, and lets /admin/login set it before an admin session technically "exists".
const ADMIN_COOKIE_PATH = "/admin";

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
    await reply.setCookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      path: ADMIN_COOKIE_PATH,
      maxAge: 60 * 60 * 12,
    });

    return { ok: true };
  });

  app.post("/admin/logout", async (_request, reply) => {
    await reply.clearCookie(ADMIN_SESSION_COOKIE, { path: ADMIN_COOKIE_PATH });
    return { ok: true };
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
}
