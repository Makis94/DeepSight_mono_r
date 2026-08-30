---
name: auth-bypass
description: >-
  Use this skill for BOTH directions of a local-only "skip Telegram auth" hack (a
  deliberate throwaway костыль): applying it so apps/web + apps/api run without any
  Telegram login during local development, and fully reverting it before pushing so
  nothing auth-bypassing ever lands on main / prod. One skill, two modes — pick the
  mode from what the user asks. Apply triggers (RU): "сделай костыль для скипа
  авторизации", "сделай заглушку авторизации", "отключи авторизацию локально",
  "убери логин на локалке", "залогинь меня без телеграма". Apply triggers (EN):
  "skip auth for local", "stub out auth", "bypass telegram login locally", "disable
  auth for dev". Revert triggers (RU): "верни авторизацию", "откати костыль
  авторизации", "убери заглушку перед пушем", "почисти костыль". Revert triggers
  (EN): "restore auth", "revert the auth bypass", "remove the auth stub before
  push", "undo the костыль". If the user just says "костыль авторизации" with no
  direction, check whether the bypass is currently applied (see "Which mode am I
  in") and do the opposite.
---

# Local-only auth bypass (apply + revert)

A deliberate, throwaway hack to run the stack with **no Telegram login** during local
development, plus a clean, deterministic way to remove every trace of it before pushing.

The design goal is **safe to apply, trivial to revert**:

- Every code change is a **single `if (...) return ...;` line** wrapped in greppable
  `AUTH-BYPASS COSTYL` sentinel comments. One `git grep` finds all of them.
- All bypass logic lives in **one new, git-excluded file** — nothing bypass-related is
  ever tracked by git.
- **Two independent kill-switches**, both must be true for the bypass to do anything:
  1. `AUTH_BYPASS=1` in `apps/api/.env` (opt-in, per developer, `.env` is gitignored)
  2. `NODE_ENV !== "production"` — `docker-compose.prod.yml` pins `NODE_ENV: production`,
     so the bypass **cannot activate on the deployed VM** even if the flag leaked there.
- A loud `app.log.warn` banner prints on every API boot while the bypass is live.
- A marker file `apps/api/.auth-bypass-active` + an optional `pre-push` hook make it
  hard to forget.

## Which mode am I in

```bash
git grep -l "AUTH-BYPASS COSTYL" -- apps 2>/dev/null; \
test -f apps/api/.auth-bypass-active && echo "marker present"; \
test -f apps/api/src/dev/auth-bypass.ts && echo "bypass file present"; \
grep -q '^AUTH_BYPASS=' apps/api/.env && echo ".env flag present"
```

- Any output → the bypass is **currently applied** → a bare "костыль авторизации" means **revert**.
- No output → it is **not applied** → a bare request means **apply**.

---

# MODE A — APPLY the костыль

Do all of this without stopping for confirmation (it is local, reversible, and cannot
reach prod) — but if `apps/api/.env` is missing, stop and say so (see `run-local-dev`).

### 1. New file — `apps/api/src/dev/auth-bypass.ts`

Create it exactly like this:

```ts
import type { Session, SubscriptionResponse } from "@hypertracker/shared";
import { env } from "../env.js";

// ┌─ AUTH-BYPASS COSTYL (local dev only) — remove before pushing ─────────────────┐
// This whole file is inert unless BOTH hold:
//   1. process.env.AUTH_BYPASS === "1"  — opt-in, lives only in apps/api/.env (gitignored)
//   2. env.NODE_ENV !== "production"    — docker-compose.prod.yml pins NODE_ENV=production,
//                                         so this cannot activate on the deployed VM.
// Revert instructions: .claude/skills/auth-bypass (MODE B).
// └─────────────────────────────────────────────────────────────────────────────┘
export function authBypassEnabled(): boolean {
  return env.NODE_ENV !== "production" && process.env.AUTH_BYPASS === "1";
}

// Stable fake identity for every bypassed request. telegramId 1 is deliberately
// non-real. Shape matches sessionSchema in packages/shared/src/auth/session.ts.
export const DEV_BYPASS_SESSION: Session = {
  telegramId: 1,
  username: "localdev",
  firstName: "Local Dev",
  authMethod: "login_widget",
};

// Synthetic "always subscribed" payload so the web dashboard mounts with no real
// subscriptions row. Shape matches subscriptionResponseSchema in packages/shared.
export function devBypassSubscription(): SubscriptionResponse {
  return {
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    trialAvailable: false,
  };
}

let bannerShown = false;
export function logAuthBypassBannerOnce(warn: (msg: string) => void): void {
  if (bannerShown || !authBypassEnabled()) return;
  bannerShown = true;
  warn(
    "*** AUTH BYPASS ACTIVE — every request runs as telegramId=1. Local dev only. " +
      "Revert via .claude/skills/auth-bypass before pushing. ***",
  );
}
```

Check the import path resolves: `apps/api/src/dev/` is one level below `src/`, so
`../env.js` is correct. If `@hypertracker/shared` does not re-export `SubscriptionResponse`
from its root, import it from `@hypertracker/shared/schemas/subscription` instead — verify
with `grep -r "SubscriptionResponse" packages/shared/src/index.ts`.

### 2. Patch the choke points

Each patch is **one line + 2 sentinel comment lines**. Insert at the very top of the
function/handler body, before anything else.

**a. `apps/api/src/modules/auth/guard.ts`** — first lines inside `requireSession(...)`:

```ts
// ┌─ AUTH-BYPASS COSTYL — remove before prod — .claude/skills/auth-bypass ─┐
if (authBypassEnabled()) return DEV_BYPASS_SESSION;
// └─ AUTH-BYPASS COSTYL end ─┘
```

Add the import at the top of the file:
`import { authBypassEnabled, DEV_BYPASS_SESSION } from "../../dev/auth-bypass.js";`

**b. `apps/api/src/modules/subscription/guard.ts`** — first lines inside
`requireActiveSubscription(...)` (this single line skips both the `requireSession` call
and the 402 subscription DB check):

```ts
// ┌─ AUTH-BYPASS COSTYL — remove before prod — .claude/skills/auth-bypass ─┐
if (authBypassEnabled()) return DEV_BYPASS_SESSION;
// └─ AUTH-BYPASS COSTYL end ─┘
```

Import: `import { authBypassEnabled, DEV_BYPASS_SESSION } from "../../dev/auth-bypass.js";`

**c. `apps/api/src/modules/subscription/routes.ts`** — first lines inside the
`app.get("/subscription", ...)` handler, before `requireSession`:

```ts
// ┌─ AUTH-BYPASS COSTYL — remove before prod — .claude/skills/auth-bypass ─┐
if (authBypassEnabled()) return devBypassSubscription();
// └─ AUTH-BYPASS COSTYL end ─┘
```

Import: `import { authBypassEnabled, devBypassSubscription } from "../../dev/auth-bypass.js";`

**d. `apps/api/src/server.ts`** — inside `buildServer()`, right after `const app = Fastify({...})`
is constructed:

```ts
// ┌─ AUTH-BYPASS COSTYL — remove before prod — .claude/skills/auth-bypass ─┐
logAuthBypassBannerOnce((msg) => app.log.warn(msg));
// └─ AUTH-BYPASS COSTYL end ─┘
```

Import: `import { logAuthBypassBannerOnce } from "./dev/auth-bypass.js";`

**e. (OPTIONAL — only if you need the live WS feed locally without logging in)**
`apps/api/src/modules/realtime/routes.ts` — first lines inside `handleConnection(...)`:

```ts
// ┌─ AUTH-BYPASS COSTYL — remove before prod — .claude/skills/auth-bypass ─┐
if (authBypassEnabled()) {
  const bypassClient = await hub.addClient(socket, DEV_BYPASS_SESSION.telegramId);
  socket.on("close", () => hub.removeClient(bypassClient));
  return;
}
// └─ AUTH-BYPASS COSTYL end ─┘
```

Import: `import { authBypassEnabled, DEV_BYPASS_SESSION } from "../../dev/auth-bypass.js";`
Skip this one unless asked — a guide page and most UI work never touches realtime.

### 3. Env flag + marker + git exclude

```bash
# opt-in flag (apps/api/.env is gitignored)
printf '\nAUTH_BYPASS=1\n' >> apps/api/.env

# marker so "which mode am I in" and the pre-push hook can see it
date -u +"applied %Y-%m-%dT%H:%M:%SZ" > apps/api/.auth-bypass-active

# belt-and-braces: keep the new file + marker un-addable by `git add .`
printf 'apps/api/src/dev/auth-bypass.ts\napps/api/.auth-bypass-active\n' >> .git/info/exclude
```

Confirm nothing bypass-related is tracked:
`git status --porcelain | grep -E 'auth-bypass|\.auth-bypass-active'` → **must be empty**.
The only things `git status` should show are the sentinel edits in the 3–4 patched files.

### 4. (OPTIONAL) install the pre-push guard

```bash
cat > .git/hooks/pre-push <<'EOF'
#!/usr/bin/env bash
if git grep -qI "AUTH-BYPASS COSTYL" -- apps packages 2>/dev/null; then
  echo "push blocked: AUTH-BYPASS COSTYL sentinels still in tracked files." >&2
  echo "revert via .claude/skills/auth-bypass (MODE B) first." >&2
  exit 1
fi
if [ -f apps/api/.auth-bypass-active ]; then
  echo "push blocked: apps/api/.auth-bypass-active present — auth bypass not reverted." >&2
  exit 1
fi
EOF
chmod +x .git/hooks/pre-push
```

(The new file is git-excluded so `git grep` never matches it — the hook only fires if a
sentinel patch accidentally got into a **tracked** file.)

### 5. Restart & verify

Restart `apps/api` (or the whole `turbo run dev` — see `run-local-dev`). Then:

```bash
# API boot log shows the banner:  "*** AUTH BYPASS ACTIVE ..."
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/auth/session      # expect 200
curl -s http://localhost:3001/subscription -H 'x-bypass: n/a'                    # expect status:"active"
```

Open `http://localhost:5173` in a plain browser — it should land straight on the feed,
no Telegram login screen. No `apps/web` changes are needed: the standalone bootstrap
(`GET /auth/session`) now returns the dev session on its own.

### 6. Tell the user, verbatim

State plainly: the bypass is **applied and active**, list the patched files, and remind
them to run **MODE B of this skill before pushing**. Never commit with the bypass on.

---

# MODE B — REVERT the костыль

### 1. Find every trace

```bash
git grep -n "AUTH-BYPASS COSTYL" -- apps packages
ls -la apps/api/src/dev/auth-bypass.ts apps/api/.auth-bypass-active 2>/dev/null
grep -n '^AUTH_BYPASS=' apps/api/.env
grep -n 'auth-bypass' .git/info/exclude
```

### 2. Remove the code patches

**Fast path — if the patched files have no _other_ uncommitted changes**
(`git diff --stat -- <file>` shows only the sentinel lines):

```bash
git checkout -- \
  apps/api/src/modules/auth/guard.ts \
  apps/api/src/modules/subscription/guard.ts \
  apps/api/src/modules/subscription/routes.ts \
  apps/api/src/server.ts \
  apps/api/src/modules/realtime/routes.ts   # only if patch (e) was applied
```

**Surgical path — if any of those files also has unrelated edits you must keep:**
for each file, delete the 3–6 line block from the opening `// ┌─ AUTH-BYPASS COSTYL`
through the matching `// └─ AUTH-BYPASS COSTYL end ─┘`, **and** delete the
`import { ... } from ".../dev/auth-bypass.js";` line. Use the `git grep -n` output from
step 1 as the line index. Re-run `git grep "AUTH-BYPASS COSTYL"` after — must be empty.

### 3. Remove the file, marker, flag, excludes

```bash
rm -f apps/api/src/dev/auth-bypass.ts
rmdir apps/api/src/dev 2>/dev/null || true      # only if now empty
rm -f apps/api/.auth-bypass-active
# drop the AUTH_BYPASS line from apps/api/.env (keep the rest of the file intact):
sed -i '/^AUTH_BYPASS=/d' apps/api/.env
# drop the two exclude lines:
sed -i '\#apps/api/src/dev/auth-bypass.ts#d; \#apps/api/.auth-bypass-active#d' .git/info/exclude
```

Optionally remove the pre-push hook: `rm -f .git/hooks/pre-push`.

### 4. Verify the revert is complete

```bash
git grep -n "AUTH-BYPASS COSTYL" -- apps packages     # no output
git status --porcelain                                # no auth-bypass / dev/ entries
grep -c AUTH_BYPASS apps/api/.env                     # 0
pnpm --filter @hypertracker/api typecheck             # or: pnpm -w typecheck / turbo run typecheck
```

Then restart `apps/api` and confirm auth is back:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/auth/session   # expect 401
```

`http://localhost:5173` in a plain browser should show the Telegram login screen again.

### 5. Tell the user, verbatim

State plainly that the bypass is **fully reverted**, that `git grep` for the sentinel is
clean, and that typecheck passes. Now it is safe to commit / push.

---

## Notes

- `apps/web` is intentionally **never** modified — routing all of this through
  `GET /auth/session` keeps the client honest and the revert surface tiny.
- If `packages/shared`'s root barrel doesn't export `Session` / `SubscriptionResponse`,
  import from the sub-paths (`@hypertracker/shared/auth/session`,
  `@hypertracker/shared/schemas/subscription`) — do not add `any`.
- Do not extend this to `apps/admin` (separate credential, not the unified Telegram
  identity — see CLAUDE.md) or to the bot.
- This bypass is a local convenience only. It is never an acceptable state to commit,
  and there is no "prod feature flag" version of it — if that ever comes up, that's a
  real design conversation, not this skill.
