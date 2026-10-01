/**
 * Schema-vs-migration drift guard for the timestamptz migration. The latest
 * drizzle snapshot records what the migrations leave in the database; this
 * asserts every timestamp column's type there agrees with the
 * `withTimezone` flag in src/db/schema.ts. A mismatch is the deploy-order
 * hazard in openspec/decisions/2026-09-30-timestamptz-migration-plan.md
 * (Drizzle appends `+0000` to a string that already has an offset, or parses
 * an offset-less one in the wrong zone). tests/unit/
 * timestampWithTimezoneConsistency.test.ts only checks schema.ts against
 * itself, so it cannot see this.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, PgTimestamp } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

interface SnapshotColumn {
  name: string;
  type: string;
}
interface Snapshot {
  tables: Record<string, { name: string; columns: Record<string, SnapshotColumn> }>;
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number }[] };
const latestIdx = journal.entries[journal.entries.length - 1].idx;
const snapshot = JSON.parse(
  readFileSync(`drizzle/meta/${String(latestIdx).padStart(4, "0")}_snapshot.json`, "utf8"),
) as Snapshot;

/** table name -> db column name -> withTimezone, from schema.ts. */
function schemaFlags(): Map<string, Map<string, boolean>> {
  const out = new Map<string, Map<string, boolean>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cols = new Map<string, boolean>();
    for (const column of Object.values(getTableColumns(value))) {
      if (is(column, PgTimestamp)) cols.set(column.name, column.withTimezone);
    }
    if (cols.size > 0) out.set(getTableName(value), cols);
  }
  return out;
}

/** table name -> db column name -> withTimezone, from the latest snapshot. */
function snapshotFlags(): Map<string, Map<string, boolean>> {
  const out = new Map<string, Map<string, boolean>>();
  for (const table of Object.values(snapshot.tables)) {
    const cols = new Map<string, boolean>();
    for (const col of Object.values(table.columns)) {
      if (col.type === "timestamp with time zone") cols.set(col.name, true);
      else if (col.type === "timestamp") cols.set(col.name, false);
    }
    if (cols.size > 0) out.set(table.name, cols);
  }
  return out;
}

test("latest snapshot timestamp columns agree with schema.ts withTimezone flags", () => {
  const fromSnapshot = snapshotFlags();
  for (const [tableName, cols] of schemaFlags()) {
    const snapCols = fromSnapshot.get(tableName);
    assert.ok(snapCols, `${tableName} has timestamp columns in schema.ts but none in the latest snapshot`);
    for (const [colName, withTz] of cols) {
      assert.equal(
        snapCols.get(colName),
        withTz,
        `${tableName}.${colName}: schema.ts says withTimezone=${withTz}, latest snapshot says ${snapCols.get(colName)}`,
      );
    }
  }
});

test("latest snapshot has no timestamp column that schema.ts lacks", () => {
  const fromSchema = schemaFlags();
  for (const [tableName, cols] of snapshotFlags()) {
    for (const colName of cols.keys()) {
      assert.ok(fromSchema.get(tableName)?.has(colName), `${tableName}.${colName} is in the snapshot but not in schema.ts`);
    }
  }
});
