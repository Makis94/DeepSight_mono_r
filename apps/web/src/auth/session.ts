import { sessionSchema, type Session } from "@hypertracker/shared/auth/session";

const STORAGE_KEY = "hypertracker_session_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Reads the JWT payload for display (avatar, name) only — the signature was already
// verified server-side when apps/api issued this token, and every API/WS request still
// carries the raw token for the server to re-verify, so no security decision here ever
// depends on this being unforgeable client-side.
export function decodeSessionToken(token: string): Session | null {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return null;
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json: unknown = JSON.parse(atob(base64));
    const result = sessionSchema.safeParse(json);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
