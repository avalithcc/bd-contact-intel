/**
 * Replays a real drizzle migration file against a throwaway schema instead of `public`.
 *
 * Why: a test that wants "the world before migration N" used to run `DROP TABLE` / `ALTER TABLE "bd" DROP COLUMN` on the shared
 * `public` tables inside a transaction it later rolled back. Those statements take ACCESS EXCLUSIVE locks on `bd` (and, through
 * the foreign keys, on the tables that reference it), so every other test file running in parallel against the same database
 * blocked behind them or was killed with `deadlock detected` (observed as gmailFleet.test.ts and gmailReminder.test.ts failing
 * in roughly 3 of 20 full parallel runs). In a private schema the same DDL locks nothing anyone else uses.
 *
 * Call inside a transaction and throw to roll back: DDL is transactional, so the schema disappears with it.
 */
import { sql } from "drizzle-orm";

type Tx = { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> };

/**
 * Creates `schema`, a minimal pre-migration `bd` table in it, and points `search_path` at it for the rest of the transaction.
 * `bd` carries only what the replayed migrations and the tests touch (id, name, email); everything else about `bd` is irrelevant
 * to a migration that adds one column.
 */
export async function createIsolatedBd(tx: Tx, schema: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(schema)) throw new Error(`unsafe schema name: ${schema}`);
  await tx.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
  await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
  await tx.execute(sql.raw(`CREATE TABLE "bd" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "name" text NOT NULL, "email" text NOT NULL UNIQUE)`));
}

/** Splits a migration file into statements and retargets its explicit `public` references to `schema`. */
export function migrationStatements(fileText: string, schema: string): string[] {
  return fileText
    .split("--> statement-breakpoint")
    .map((s) => s.replaceAll("'public'", `'${schema}'`).replaceAll('"public".', `"${schema}".`));
}
