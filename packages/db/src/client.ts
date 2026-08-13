import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

/**
 * A dedicated raw connection for LISTEN/NOTIFY — Postgres notifications only reach
 * connections that are actively listening, and Drizzle's pooled query connection isn't a
 * fit for that. Only for LISTEN or `pg_notify()`; use `createDb` for everything else.
 */
export function createListenClient(connectionString: string) {
  return postgres(connectionString);
}

export type ListenClient = ReturnType<typeof createListenClient>;
