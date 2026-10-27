/**
 * Runs the pure journal guard (src/lib/migration/journalGuard.ts) on the real
 * drizzle/meta/_journal.json and drizzle/*.sql. No database: it runs locally, in
 * the pre-commit hook and in CI. A failure message says exactly how to fix it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { checkMigrationJournal, type GuardEntry } from "../../src/lib/migration/journalGuard";

test("the real migration journal is consistent with drizzle/*.sql and every new entry is above the ledger max", () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: GuardEntry[] };
  const sqlFiles = readdirSync("drizzle").filter((f) => f.endsWith(".sql"));
  assert.deepEqual(checkMigrationJournal(journal.entries, sqlFiles), []);
});
