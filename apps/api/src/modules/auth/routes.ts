import { type Database, users } from "@hypertracker/db";
import {
  AuthVerificationError,
  verifyLoginWidget,
  verifyMiniAppInitData,
  type Session,
} from "@hypertracker/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../env.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { verifySessionToken } from "./jwt.js";
import { issueSession, revokeSession } from "./session-store.js";

const miniAppBodySchema = z.object({ initData: z.string() });
const loginWidgetBodySchema = z.object({ payload: z.record(z.string()) });

// First time we see a telegram_id, create its users row — nothing else in the system
// does this. Everything downstream (watched_wallets FK, settings) assumes the row
// already exists once a session token has been issued.
async function ensureUserRow(db: Database, session: Session): Promise<void> {
  await db
    .insert(users)
    .values({
      telegramId: session.telegramId,
      ...(session.username !== undefined ? { username: session.username } : {}),
      ...(session.firstName !== undefined ? { firstName: session.firstName } : {}),
    })
    .onConflictDoNothing({ target: users.telegramId });
}

export function authRoutes(app: FastifyInstance, db: Database, hub: RealtimeHub): void {
  app.post("/auth/mini-app", async (request, reply) => {
    const body = miniAppBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid request body" });
      return;
    }

    try {
      const session = verifyMiniAppInitData(body.data.initData, env.BOT_TOKEN);
      await ensureUserRow(db, session);
      // Revokes whatever session this telegramId already had — see issueSession's doc
      // comment. forceDisconnect then closes that old session's live WS socket immediately
      // rather than leaving it to notice on its own.
      const token = await issueSession(db, session, env.JWT_SECRET);
      hub.forceDisconnect(session.telegramId);
      return { token, session };
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        await reply.status(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  app.post("/auth/login-widget", async (request, reply) => {
    const body = loginWidgetBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid request body" });
      return;
    }

    try {
      const session = verifyLoginWidget(body.data.payload, env.BOT_TOKEN);
      await ensureUserRow(db, session);
      const token = await issueSession(db, session, env.JWT_SECRET);
      hub.forceDisconnect(session.telegramId);
      return { token, session };
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        await reply.status(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Makes "sign out" actually kill the token server-side instead of only clearing it from
  // the caller's own localStorage (apps/web's App.tsx calls this before clearToken()).
  // Deliberately tolerant of a missing/already-invalid token — signing out is idempotent from
  // the client's point of view either way.
  app.post("/auth/logout", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (token) {
      try {
        const { jti } = await verifySessionToken(token, env.JWT_SECRET);
        await revokeSession(db, jti);
      } catch {
        // Already invalid/expired/malformed — nothing to revoke.
      }
    }
    await reply.status(204).send();
  });
}
