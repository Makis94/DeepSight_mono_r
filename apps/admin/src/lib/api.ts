// Subpath import, not the package root — see apps/web/src/lib/api.ts for why (keeps
// non-admin schema code out of this bundle).
import { adminUsersResponseSchema, type AdminUserRow } from "@hypertracker/shared/schemas/admin";

const API_URL = import.meta.env.VITE_API_URL;

// Thrown on a 401 from either the login attempt itself or a since-expired session — callers
// use this to distinguish "show the login form" from any other failure.
export class AdminAuthError extends Error {}

export async function adminLogin(username: string, password: string): Promise<void> {
  const response = await fetch(`${API_URL}/admin/login`, {
    method: "POST",
    // Admin auth is cookie-based (see apps/api's ADMIN_SESSION_COOKIE), unlike the
    // Bearer-token user session — the browser must be told to send/store it cross-request.
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) {
    throw new AdminAuthError("invalid credentials");
  }
  if (response.status === 429) {
    throw new Error("too many attempts — try again later");
  }
  if (!response.ok) {
    throw new Error(`login failed: ${response.status}`);
  }
}

export async function adminLogout(): Promise<void> {
  await fetch(`${API_URL}/admin/logout`, { method: "POST", credentials: "include" });
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const response = await fetch(`${API_URL}/admin/users`, { credentials: "include" });
  if (response.status === 401) {
    throw new AdminAuthError("session expired");
  }
  if (!response.ok) {
    throw new Error(`failed to load users: ${response.status}`);
  }
  return adminUsersResponseSchema.parse(await response.json()).users;
}
