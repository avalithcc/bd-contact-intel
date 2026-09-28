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

// `max` is how many Postgres connections ONE serverless instance may hold.
// It trades page latency against a connection budget that every warm
// instance draws from: production, every warm preview, the crons, and any
// local `next dev` pointed at the same DATABASE_URL (which uses 5).
//
// Why it matters: at `max: 1` every `Promise.all` in the app serializes at
// the database. One connection runs one query at a time, so the promises
// interleave but the queries do not. Measured 2026-09-28 against production
// with the real `/contacts` query set: 2482ms at `max: 1`, 1642ms at `max: 3`.
//
// The budget is Supavisor's session-mode pool_size, NOT Postgres's
// `max_connections` (60). In session mode each client connection holds one
// pooler slot for its whole life (released after `idle_timeout` seconds
// idle), so the sum of `max` across all warm instances must stay under
// pool_size.
//
// History, 2026-09-28:
// - Raised 1 -> 3 while pool_size was 15, reasoning from Postgres's 60.
//   Production threw `EMAXCONNSESSION: max clients reached in session mode -
//   max clients are limited to pool_size: 15` and it was reverted the same
//   day. Measuring Postgres does not tell you the pooler's limit.
// - The owner then raised pool_size in the Supabase dashboard (Database ->
//   Connection pooling). A probe held 20 concurrent session clients on top
//   of 4 already in use with no failure, so the pool admits at least 24.
//   Raised 1 -> 3 again on that basis.
//
// Before raising this further, re-check pool_size against the number of
// warm instances. If a page still looks round-trip-bound, prefer removing
// round trips (combine several small reads into one statement): that
// shortens the work and does not spend connections.
//
// DO NOT switch DATABASE_URL to the transaction-mode pooler (port 6543) to
// get around the budget. It was the planned fix and it HANGS the app,
// measured the same day with the real `/contacts` query set:
//
//   session     5432  max:1  ok    2482ms
//   session     5432  max:3  ok    1642ms
//   transaction 6543  max:1  HUNG
//   transaction 6543  max:3  HUNG
//   transaction 6543  max:5  ok    1624ms
//
// Cause: postgres.js pipelines queued queries onto a busy connection, and
// Supavisor in transaction mode deadlocks on pipelined queries that carry
// NO bound parameters (simple query protocol). Several of ours have none —
// `getHiringCompanyKeys`, the filter-option DISTINCTs, `listOwnerOptions` —
// and a page fires them together. A synthetic probe stepping 2, 3, 4, 6 and
// 10 concurrent parameterless queries hung at 3 with max:1, at 4 with max:3
// and at 6 with max:5. Parameterized queries never hung at any size, and
// session mode never hung at all. So `max:5` "working" above is headroom,
// not safety: the next page with more concurrent reads hangs, silently.
//
// `prepare: false` stays: harmless in session mode, and required by any
// transaction-mode pooler if that is ever revisited with a fix for the above.
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
