import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Durable per-consumer replay cursor. LISTEN/NOTIFY itself carries no history, so a
// consumer that needs to survive restarts without dropping events (e.g. the bot notifier)
// resumes from `events WHERE id > lastEventId` instead of replaying from the start.
export const eventCursors = pgTable("event_cursors", {
  consumer: text("consumer").primaryKey(),
  lastEventId: bigint("last_event_id", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EventCursor = typeof eventCursors.$inferSelect;
export type NewEventCursor = typeof eventCursors.$inferInsert;
