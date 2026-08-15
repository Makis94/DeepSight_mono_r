// Minimal in-memory brute-force guard for /admin/login. Single apps/api process, single
// admin account — no need for a distributed store here, unlike anything user-facing.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

const attemptsByKey = new Map<string, { count: number; resetAt: number }>();

export function isLoginRateLimited(key: string): boolean {
  const entry = attemptsByKey.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedLoginAttempt(key: string): void {
  const now = Date.now();
  const entry = attemptsByKey.get(key);
  if (!entry || entry.resetAt < now) {
    attemptsByKey.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginAttempts(key: string): void {
  attemptsByKey.delete(key);
}
