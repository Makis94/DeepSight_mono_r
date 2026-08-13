import { sessionSchema, type Session } from "@hypertracker/shared";
import { jwtVerify, SignJWT } from "jose";

const SESSION_TTL = "30d";

export async function signSession(session: Session, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(key);
}

export async function verifySessionToken(token: string, secret: string): Promise<Session> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return sessionSchema.parse(payload);
}
