/**
 * Deploy-order-hazard guard for the timestamptz migration
 * (openspec/decisions/2026-09-30-timestamptz-migration-plan.md, "biggest
 * risk"): a column becoming `timestamptz` in the DB while `schema.ts` still
 * says `withTimezone: false` for it (or the reverse) makes Drizzle's
 * `PgTimestamp.mapFromDriverValue` either append `+0000` to a string that
 * already carries an offset, or parse an offset-less string in the wrong
 * timezone — silently `Invalid Date` (or a wrong instant) on every typed
 * read of that table. A partial per-table flip — some of a table's
 * `timestamp(...)` columns updated to `{ withTimezone: true }`, others not
 * — is the same hazard at the granularity of a single migration PR.
 *
 * This test asserts every `timestamp(...)` column in a given table shares
 * the SAME `withTimezone` setting, so that mistake fails here instead of in
 * prod. `CONVERTED_TABLES` is the checklist future slices update as they
 * flip a table's columns to `{ withTimezone: true }` in the SAME PR as its
 * migration — keeping it here (checked against the schema itself) makes a
 * partial flip visible in review, not just in this file's own diff.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, PgTimestamp } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * Tables whose `timestamp(...)` columns have ALL been flipped to
 * `{ withTimezone: true }` in schema.ts, in step with an applied
 * `ALTER COLUMN ... TYPE timestamptz` migration (plan's "Slices" section).
 * Slice 1 (small, low-traffic tables), slice 2 (imported tables:
 * job_posting, contact, conversation, message) and slice 3 (lead, person)
 * have been converted.
 */
const CONVERTED_TABLES: readonly string[] = [
  "bd",
  "company_category",
  "target_company",
  "company_alias",
  "sync_run",
  "discovery_run",
  "company_probe",
  "email_domain_check",
  "lead_source",
  "board_candidate",
  "person_property_history",
  "person_id_map",
  "merge_event",
  "duplicate_candidate",
  "audit_log",
  "migration_run",
  "saved_view",
  "company_property_history",
  "signal",
  "linkedin_scrape_job",
  "email_never_log",
  "task_digest_send",
  "job_posting",
  "contact",
  "conversation",
  "message",
  "lead",
  "person",
];

function withTimezoneFlagsByTable(): Map<string, boolean[]> {
  const byTable = new Map<string, boolean[]>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const flags = Object.values(getTableColumns(value))
      .filter((column) => is(column, PgTimestamp))
      .map((column) => column.withTimezone);
    if (flags.length > 0) byTable.set(getTableName(value), flags);
  }
  return byTable;
}

test("every table's timestamp columns share the same withTimezone setting (no partial per-table flip)", () => {
  for (const [tableName, flags] of withTimezoneFlagsByTable()) {
    assert.equal(
      new Set(flags).size,
      1,
      `${tableName} mixes withTimezone: true and withTimezone: false columns — a partial ` +
        `per-table flip is exactly the deploy-order hazard the migration plan warns about`,
    );
  }
});

test("CONVERTED_TABLES matches the tables whose columns are ALL withTimezone: true", () => {
  const actuallyConverted = [...withTimezoneFlagsByTable()]
    .filter(([, flags]) => flags.every((f) => f === true))
    .map(([tableName]) => tableName)
    .sort();
  assert.deepEqual(
    actuallyConverted,
    [...CONVERTED_TABLES].sort(),
    "update CONVERTED_TABLES in this test when a slice flips a table's timestamp columns to withTimezone: true",
  );
});
