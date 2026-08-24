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
import { extractToken, requireSession, SESSION_COOKIE } from "./guard.js";
import { SESSION_TTL_MS, verifySessionToken } from "./jwt.js";
import { issueSession, revokeSession } from "./session-store.js";

const miniAppBodySchema = z.object({ initData: z.string() });
const loginWidgetBodySchema = z.object({ payload: z.record(z.string()) });

const isProduction = env.NODE_ENV === "production";

// Hand-rolled instead of reply.setCookie()/clearCookie() — see apps/admin's routes.ts for
// why (@fastify/cookie@11.1.2's setCookie writes from inside its own onSend hook, which
// reliably hangs the response on this stack; request-side parsing via request.cookies is
// unaffected, so @fastify/cookie stays registered for that). No Domain attribute needed:
// apps/web (hyper-deep-sight.com / www) and apps/api (api.hyper-deep-sight.com) are
// subdomains of the same registrable domain, so a host-only cookie set here still rides
// same-site cross-subdomain fetches under SameSite=Strict — nothing here is ever a
// cross-site request. JWTs are base64url (jose's SignJWT), so no attribute-value escaping
// is needed.
function sessionCookieHeader(token: string): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProduction) attrs.push("Secure");
  return attrs.join("; ");
}

function clearedSessionCookieHeader(): string {
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isProduction) attrs.push("Secure");
  return attrs.join("; ");
}

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
  // Mini App context: token stays in the JSON body. apps/web holds it in memory only (never
  // localStorage) and sends it as Authorization: Bearer — Telegram's Mini App WebView/iframe
  // embedding makes cookie persistence unreliable across platforms, and this path already
  // re-authenticates silently from initData on every fresh open, so it never needed
  // persistent storage to begin with.
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

  // Standalone site: token goes ONLY into the httpOnly cookie, never the JSON body — a
  // token that's never handed to JS at all can't be exfiltrated by an XSS payload or casually
  // copied out of DevTools > Local Storage the way the old localStorage-held token could.
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
      await reply.header("set-cookie", sessionCookieHeader(token)).send({ session });
    } catch (err) {
      if (err instanceof AuthVerificationError) {
        await reply.status(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Bootstrap endpoint for the standalone site: on load, apps/web has no way to know whether
  // the httpOnly cookie holds a valid session (JS can't read it) without asking the server.
  // Reuses requireSession verbatim, so it enforces the exact same revocation/expiry rules as
  // every other authenticated route.
  app.get("/auth/session", async (request, reply) => {
    const session = await requireSession(request, reply, db);
    if (!session) return;
    return { session };
  });

  // Makes "sign out" actually kill the token server-side instead of only discarding it
  // client-side — without this, the token being discarded would still work for anyone
  // holding a copy of it, for up to SESSION_TTL. Reads from either the Mini App's
  // Authorization header or the standalone site's cookie (same precedence as requireSession),
  // and always clears the cookie regardless of which one was actually in use — deliberately
  // tolerant of a missing/already-invalid token, since signing out is idempotent either way.
  app.post("/auth/logout", async (request, reply) => {
    const token = extractToken(request);
    if (token) {
      try {
        const { jti } = await verifySessionToken(token, env.JWT_SECRET);
        await revokeSession(db, jti);
      } catch {
        // Already invalid/expired/malformed — nothing to revoke.
      }
    }
    await reply.header("set-cookie", clearedSessionCookieHeader()).status(204).send();
  });
}
