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
import { signSession } from "./jwt.js";

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

export function authRoutes(app: FastifyInstance, db: Database): void {
  app.post("/auth/mini-app", async (request, reply) => {
    const body = miniAppBodySchema.safeParse(request.body);
    if (!body.success) {
      await reply.status(400).send({ error: "invalid request body" });
      return;
    }

    try {
      const session = verifyMiniAppInitData(body.data.initData, env.BOT_TOKEN);
      await ensureUserRow(db, session);
      const token = await signSession(session, env.JWT_SECRET);
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
      const token = await signSession(session, env.JWT_SECRET);
      return { token, session };
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        await reply.status(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });
}
