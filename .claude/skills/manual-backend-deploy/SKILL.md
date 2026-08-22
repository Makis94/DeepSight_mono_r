---
name: manual-backend-deploy
description: Use this skill whenever the user asks to deploy/redeploy/ship/update the backend (apps/api, apps/bot, apps/worker) to production by hand over SSH — this is currently the normal path because GitHub Actions is blocked (Copilot billing unpaid on the Makis94 account, see Settings → Billing at github.com/settings/billing — check if it's been resolved before assuming this workaround is still needed). Trigger phrases include Russian ones like "залей бек", "задеплой бек", "выкати бек на прод", "обнови прод", "закинь на сервер" as well as English "deploy the backend", "ship this to prod", "push to production", "redeploy the VM". Does NOT cover apps/web or apps/admin — those deploy automatically via Vercel on push to main, no manual step needed. This skill encodes the exact sequence plus every failure mode hit doing this manually on 2026-08-22, so they aren't rediscovered by trial and error (one of them took prod down and required a hard reboot).
---

# Manual backend deploy (GitHub Actions blocked workaround)

## Why this exists

`.github/workflows/deploy.yml` normally SSHes into the VM after CI passes and runs
`scripts/deploy.sh`. While GitHub Actions is blocked, do the exact same thing by hand — same
script, same VM, just triggered manually instead of by the Action. Don't try to design a
different deploy path; replicate what CI would have done.

## Connection details

- Static IP: `13.36.193.155` (Lightsail instance `Deep_Sight_Prod`, region `eu-west-3` / Paris)
- SSH user: `ubuntu`
- Key: on the user's Windows machine at `C:\Users\Максим\Desktop\DS\LightsailDefaultKey-eu-west-3.pem`,
  reachable from WSL at `/mnt/c/Users/Максим/Desktop/DS/LightsailDefaultKey-eu-west-3.pem`.
  **Copy it into the WSL filesystem first and `chmod 400` there** — `/mnt/c` is a drvfs mount
  and doesn't support real Unix permissions, so `ssh` will refuse the key if you point it at
  the `/mnt/c` path directly. This has to be redone every session (scratchpad is ephemeral):

  ```bash
  cp "/mnt/c/Users/Максим/Desktop/DS/LightsailDefaultKey-eu-west-3.pem" <scratchpad>/.ssh/lightsail.pem
  chmod 400 <scratchpad>/.ssh/lightsail.pem
  ```

- Repo on the VM: `/opt/hypertracker`
- Prod domain: `https://api.hyper-deep-sight.com` (`/health` → `{"status":"ok",...}`)

## Running the deploy

```bash
ssh -i <scratchpad>/.ssh/lightsail.pem -o ConnectTimeout=10 ubuntu@13.36.193.155 \
  "cd /opt/hypertracker && bash scripts/deploy.sh"
```

Always run this with `run_in_background: true` — the build takes minutes and the output is
large (buildkit output). Poll the task's output file instead of blocking.

`scripts/deploy.sh` does: `git fetch && git reset --hard origin/main` → build images → run
Drizzle migrations → `docker compose up -d` → prune old images → print `docker compose ps`.

**The build step must stay `docker compose --parallel 1 -f docker-compose.prod.yml build`
(sequential), not the default parallel build.** This was the cause of a real outage: the VM is
only 2 vCPU / 2GB RAM (Lightsail $12/mo plan), and building all 8 images in parallel pegs it
hard enough that the _live_ containers become unresponsive and even SSH itself stops accepting
new connections (banner-exchange timeout) mid-deploy. If `scripts/deploy.sh` on the VM doesn't
already have `--parallel 1` in the build line, that's a regression — restore it before deploying
again, don't just retry the parallel build.

## Verifying after deploy

```bash
curl -sS -m 10 -w '\nhttp_code=%{http_code}\n' https://api.hyper-deep-sight.com/health
ssh -i <scratchpad>/.ssh/lightsail.pem ubuntu@13.36.193.155 \
  "docker compose -f /opt/hypertracker/docker-compose.prod.yml ps; git -C /opt/hypertracker log -1 --oneline"
```

Expect `health` → `200`, every service `healthy` (not just `Up`), and the VM's commit matching
local `HEAD`.

## If the VM stops responding mid-deploy (SSH times out on banner exchange)

This means the box is CPU/RAM-starved (should not happen anymore with `--parallel 1`, but if it
does): regular SSH and even the AWS Lightsail browser terminal ("Connect" tab, "Connecting to
your instance...") both go through the _same_ saturated sshd, so neither will get you in. The
only reliable recovery is the **Reboot** button on the instance's Lightsail console page
(top-right, next to Delete/Stop) — that's an AWS control-plane call, not a request to the VM
itself, so it works regardless of how overloaded the instance is.

After reboot: every service in `docker-compose.prod.yml` has `restart: unless-stopped`, so the
stack comes back up automatically — but on whatever images were last _successfully_ built, i.e.
the deploy that was interrupted does **not** apply. Re-run `scripts/deploy.sh` (with the
sequential build fix) once the instance is back to actually land the new commit.

## Schema-change gotcha: a bad legacy DB row can 500 the entire `/events` endpoint

`apps/api`'s `GET /events` (`apps/api/src/modules/events/routes.ts`) fetches recent rows per
event type and validates the **whole batch at once** with
`recentEventsResponseSchema.parse(...)` — a single row whose stored `payload` JSON doesn't match
the _current_ Zod schema throws and 500s the response for everyone, not just that row. This bit
us on 2026-08-22: a deploy tightened `marketTwapSuspectedPayloadSchema` (dropped
`source: z.literal("heuristic")`, added a required `twapId: z.number()`), and ~20k pre-existing
`market_twap_suspected` rows from before the deploy had no `twapId` — every one of them broke
`/events` for the entire app (large trades, wallet tracker, everything — not just TWAPs, since
it's one endpoint feeding all feed panels).

**After any deploy that changes a payload schema in `packages/shared/src/schemas/events.ts`**,
check whether old rows in the `events` table still validate against the new shape:

```bash
docker exec hypertracker-postgres-1 psql -U hypertracker -d hypertracker -c \
  "select count(*) from events where type='<the changed type>' and payload ? '<new required field>' = false;"
```

If there are stale rows and the new field genuinely has no reasonable backfill (as with
`twapId` — those old rows were exactly the unconfirmed heuristic guesses the schema change was
designed to stop showing), deleting them is the right fix, not a workaround:

```sql
delete from events where type='<the changed type>' and payload ? '<new required field>' = false;
```

Confirm the count of remaining bad rows is 0 and re-check `curl .../health` and `GET /events`
(watch `docker compose logs api` for the `ZodError` disappearing) before telling the user it's
fixed. **Always confirm with the user before running a DELETE against prod data** — this is a
production database, not a local one, even when the rows are clearly obsolete.
