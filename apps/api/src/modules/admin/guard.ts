import type { AdminSession } from "@hypertracker/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { verifyAdminSessionToken } from "./jwt.js";

// Scoped to /admin (see cookie `path` set in routes.ts) so it's never sent on any
// user-facing request.
export const ADMIN_SESSION_COOKIE = "admin_session";

export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AdminSession | undefined> {
  const token = request.cookies[ADMIN_SESSION_COOKIE];
  if (!token) {
    await reply.status(401).send({ error: "missing admin session" });
    return undefined;
  }

  try {
    return await verifyAdminSessionToken(token, env.ADMIN_JWT_SECRET);
  } catch {
    await reply.status(401).send({ error: "invalid admin session" });
    return undefined;
  }
}
