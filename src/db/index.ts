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
// at once, so a generous `max` exhausts the database's connection budget
// (Supabase's session-mode pooler caps at 15 by default). One connection per
// instance plus a short idle timeout keeps that under control; `prepare:
// false` is required if DATABASE_URL points at a transaction-mode pooler and
// is harmless otherwise.
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
