import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

// Reuse the client across hot reloads in dev to avoid exhausting connections.
const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
};

// Each serverless instance gets its own pool, and many instances can be warm
// at once, so `max` trades page latency against the database's connection
// budget. `prepare: false` is required if DATABASE_URL points at a
// transaction-mode pooler and is harmless otherwise.
//
// This was `max: 1`, which made every `Promise.all` in the app serialize at
// the database: one connection processes one query at a time, so the promises
// interleave but the queries do not. Measured against production on
// 2026-09-28, three concurrent `pg_sleep(1)` queries took 5132ms at `max: 1`
// and 2501ms at `max: 5` — every multi-query page was paying roughly double.
//
// Why 3 is safe here, measured the same day rather than assumed: connections
// go through Supavisor (it shows up by name in `pg_stat_activity`), so
// instances talk to the pooler and the pooler multiplexes onto Postgres —
// the server's 60 `max_connections` are Supavisor's budget, not one slot per
// instance. At the time of the change 14 of the 57 non-reserved connections
// were in use, with one active.
//
// It is a deliberate small step, not a ceiling. If page latency still looks
// round-trip-bound, prefer removing round trips (combine several small reads
// into one statement) over raising this further — that is the lever that
// actually shortens the work, and it does not spend connections.
const client =
  globalForDb.client ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 3 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
if (process.env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
