// One-off CLI helper: `pnpm --filter @hypertracker/api hash-admin-password <password>`.
// Prints a bcrypt hash to paste into ADMIN_PASSWORD_HASH — the plaintext password is never
// meant to be written to a file (env or otherwise), only known to whoever runs this.
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("usage: pnpm --filter @hypertracker/api hash-admin-password <password>");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log(hash);
