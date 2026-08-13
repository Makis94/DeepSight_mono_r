import { events, type Database, type NewEvent } from "@hypertracker/db";
import { NOTIFICATION_CHANNEL } from "@hypertracker/shared";
import { sql } from "drizzle-orm";

export async function publishEvent(
  db: Database,
  event: Omit<NewEvent, "id" | "createdAt">,
): Promise<void> {
  // onConflictDoNothing on the partial unique index over externalId makes this idempotent
  // across process restarts — Hyperliquid resends a snapshot backlog on every (re)subscribe,
  // and this is the durable backstop for that (in-memory dedup alone doesn't survive a
  // restart). Producers that pass no externalId (null) are never deduped against each other.
  // The `where` clause must mirror the partial index's predicate exactly (see events.ts'
  // externalIdUnique) — Postgres refuses to use a partial index as an ON CONFLICT arbiter
  // otherwise ("no unique or exclusion constraint matching the ON CONFLICT specification").
  const [inserted] = await db
    .insert(events)
    .values(event)
    .onConflictDoNothing({
      target: events.externalId,
      where: sql`${events.externalId} is not null`,
    })
    .returning({ id: events.id });
  if (!inserted) return;
  await db.execute(sql`select pg_notify(${NOTIFICATION_CHANNEL}, ${String(inserted.id)})`);
}
