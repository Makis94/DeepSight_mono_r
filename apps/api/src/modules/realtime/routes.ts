import { activeSessionCondition, sessions, type Database } from "@hypertracker/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { env } from "../../env.js";
import { SESSION_COOKIE } from "../auth/guard.js";
import { verifySessionToken } from "../auth/jwt.js";
import type { RealtimeHub } from "./hub.js";

export function realtimeRoutes(app: FastifyInstance, hub: RealtimeHub, db: Database): void {
  app.get("/realtime", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    void handleConnection(socket, request);
  });

  async function handleConnection(socket: WebSocket, request: FastifyRequest): Promise<void> {
    // Mini App: token rides as a query param (a WS handshake can't carry a custom
    // Authorization header from the browser's native WebSocket API). Standalone site: the
    // browser attaches the session cookie to the handshake automatically, same as any other
    // same-site request — no query param needed at all.
    const query = request.query as { token?: string };
    const token = query.token ?? request.cookies[SESSION_COOKIE];
    if (!token) {
      socket.close(4001, "missing token");
      return;
    }

    let verified;
    try {
      verified = await verifySessionToken(token, env.JWT_SECRET);
    } catch {
      socket.close(4001, "invalid session");
      return;
    }

    // Same revocation check as the REST guard (auth/guard.ts) — a JWT that's been superseded
    // by a newer login elsewhere still verifies fine cryptographically until its own exp, so
    // the WS handshake has to check the sessions table too, not just the signature.
    const [row] = await db
      .select({ jti: sessions.jti })
      .from(sessions)
      .where(and(eq(sessions.jti, verified.jti), activeSessionCondition()))
      .limit(1);
    if (!row) {
      socket.close(4001, "invalid session");
      return;
    }

    const { session } = verified;
    if (!(await hub.hasActiveSubscription(session.telegramId))) {
      socket.close(4003, "subscription required");
      return;
    }

    const client = await hub.addClient(socket, session.telegramId);
    socket.on("close", () => hub.removeClient(client));
  }
}
