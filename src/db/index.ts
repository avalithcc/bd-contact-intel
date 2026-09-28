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
//
// INCIDENT 2026-09-28: raised to 3, reverted to 1 the same day. Production
// threw `EMAXCONNSESSION: max clients reached in session mode - max clients
// are limited to pool_size: 15`. The governing limit is **Supavisor's
// session-mode pool_size of 15**, not Postgres's `max_connections` of 60 —
// the comment this replaced said so, and it was overridden on the strength
// of the wrong measurement. Preview deployments share that same 15, so every
// warm preview competes with production for it.
//
// Do not raise this again without first raising the pooler's own
// session-mode pool_size (Supabase dashboard -> Database -> Connection
// pooling). Measuring Postgres does not tell you the pooler's limit.
//
// DO NOT switch DATABASE_URL to the transaction-mode pooler (port 6543) as
// the way around this. It was the planned fix and it HANGS the app, measured
// 2026-09-28 against production with the real `/contacts` query set:
//
//   session     5432  max:1  ok    2482ms   (production today)
//   session     5432  max:3  ok    1642ms
//   transaction 6543  max:1  HUNG
//   transaction 6543  max:3  HUNG
//   transaction 6543  max:5  ok    1624ms
//
// Cause: postgres.js pipelines queued queries onto a busy connection, and
// Supavisor in transaction mode deadlocks on pipelined queries that carry
// NO bound parameters (simple query protocol). Several of ours have none —
// `getHiringCompanyKeys`, the filter-option DISTINCTs, `listOwnerOptions` —
// and a page fires them together. Synthetic probe: it hangs as soon as the
// number of concurrent parameterless queries exceeds `max`
// (max:1 hangs at 3, max:3 at 4, max:5 at 6). Parameterized queries never
// hung at any size, and session mode never hung at all.
//
// So `max:5` "working" above is not safety, it is headroom that the next
// page with more concurrent reads will exhaust — as a hang, with no error.
// Session mode with a larger pool_size buys the same speed (1642ms vs
// 1624ms) with none of that risk.
const client =
  globalForDb.client ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 1 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
if (process.env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
