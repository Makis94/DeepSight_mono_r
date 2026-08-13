import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { env } from "../../env.js";
import { verifySessionToken } from "../auth/jwt.js";
import type { RealtimeHub } from "./hub.js";

export function realtimeRoutes(app: FastifyInstance, hub: RealtimeHub): void {
  app.get("/realtime", { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    void handleConnection(socket, request);
  });

  async function handleConnection(socket: WebSocket, request: FastifyRequest): Promise<void> {
    const query = request.query as { token?: string };
    const token = query.token;
    if (!token) {
      socket.close(4001, "missing token");
      return;
    }

    let session;
    try {
      session = await verifySessionToken(token, env.JWT_SECRET);
    } catch {
      socket.close(4001, "invalid session");
      return;
    }

    if (!(await hub.hasActiveSubscription(session.telegramId))) {
      socket.close(4003, "subscription required");
      return;
    }

    const client = await hub.addClient(socket, session.telegramId);
    socket.on("close", () => hub.removeClient(client));
  }
}
