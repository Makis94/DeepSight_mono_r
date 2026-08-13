import type { Session } from "@hypertracker/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { verifySessionToken } from "./jwt.js";

/**
 * Shared REST auth guard — extracts and verifies the same session token the realtime
 * WS gateway checks (see realtime/routes.ts), just carried via `Authorization: Bearer`
 * instead of a query param. Sends the 401 itself and returns undefined so callers can
 * `if (!session) return;` and stop.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Session | undefined> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    await reply.status(401).send({ error: "missing session token" });
    return undefined;
  }

  try {
    return await verifySessionToken(token, env.JWT_SECRET);
  } catch {
    await reply.status(401).send({ error: "invalid session token" });
    return undefined;
  }
}
