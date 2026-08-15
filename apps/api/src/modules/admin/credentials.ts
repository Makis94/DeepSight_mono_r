import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

function safeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Different lengths would make timingSafeEqual throw rather than return false, and
  // comparing against a fixed-size buffer would leak length via bcrypt's own timing anyway —
  // simplest correct behavior is to just reject unequal lengths up front.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Always runs bcrypt.compare, even on a username mismatch, so a wrong username can't be
// distinguished from a wrong password by response time.
export async function verifyAdminCredentials(
  username: string,
  password: string,
  expected: { username: string; passwordHash: string },
): Promise<boolean> {
  const usernameMatches = safeStringEqual(username, expected.username);
  const passwordMatches = await bcrypt.compare(password, expected.passwordHash);
  return usernameMatches && passwordMatches;
}
