/**
 * Guard test (merge data-loss bugfix): mergeContacts silently failed to
 * repoint two tables that reference person.id (email_message_person,
 * follow_up_queue_item) because nothing forced a reviewer to notice a new
 * FK-to-person table needs a merge decision. This test introspects the
 * REAL schema (via drizzle-orm's getTableConfig, no live DATABASE_URL
 * needed — same "schema-only import" convention as
 * tests/unit/mergedProfileKeys.test.ts) for every table with a column
 * referencing `person.id`, and fails if that table has no entry in
 * PERSON_FK_TABLE_DISPOSITION below. The next person who adds such a
 * column MUST add a disposition here — "repointed" (and wire it into
 * mergeDb.ts, matching MERGE_REPOINTED_TABLES) or "excluded" with a
 * one-line reason — instead of silently repeating this bug.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

type Disposition = "repointed" | { excluded: string };

// Every table that mergeContacts (src/lib/identity/mergeDb.ts) actually
// repoints today. Kept here, not just in mergeDb.ts, so this test can
// cross-check the two lists never drift apart silently.
const MERGE_REPOINTED_TABLES = [
  "activity",
  "task",
  "signal",
  "person_id_map",
  "person_bd_connection",
  "duplicate_candidate", // special-cased: personAId/personBId pair repoint, not a plain FK column
  "email_message_person", // this bugfix
  "follow_up_queue_item", // this bugfix
] as const;

const PERSON_FK_TABLE_DISPOSITION: Record<string, Disposition> = {
  person_bd_connection: "repointed",
  person_id_map: "repointed",
  activity: "repointed",
  task: "repointed",
  signal: "repointed",
  email_message_person: "repointed",
  follow_up_queue_item: "repointed",
  duplicate_candidate: "repointed",
  merge_event: {
    excluded: "the merge/unmerge ledger itself — survivor_id/merged_id identify the event and must never move",
  },
  person_property_history: {
    excluded:
      "historical log of a person's own field changes over time; a merge writes its own new rows via survivorId, pre-merge rows describe what happened to whichever identity existed at the time (existing behavior, unchanged by this fix)",
  },
  audit_log: {
    excluded: "immutable accountability trail — who did what, when is fixed at the time of the action, never migrated",
  },
  email_message: {
    excluded:
      "person_id here is a convenience first-match column only; email_message_person is the authoritative source and IS repointed (this fix) — see email_message's doc comment in schema.ts",
  },
  linkedin_scrape_job: {
    excluded: "one-off Apify scrape run bookkeeping, not read through personId for any live feature",
  },
};

test("every table with a person_id-style FK to person.id has an explicit, reviewed disposition", () => {
  const tablesWithPersonFk = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== "object") continue;
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue; // not a pgTable (a type export, a column, etc.)
    }
    if (config.name === "person") continue; // merged_into_id is the merge mechanism itself, not a "child table"
    for (const fk of config.foreignKeys) {
      if (fk.reference().foreignTable === schema.person) tablesWithPersonFk.add(config.name);
    }
  }

  assert.ok(tablesWithPersonFk.size > 0, "sanity check: the schema introspection itself must find at least one FK to person.id");

  for (const name of tablesWithPersonFk) {
    assert.ok(
      name in PERSON_FK_TABLE_DISPOSITION,
      `"${name}" has a column referencing person.id but no entry in PERSON_FK_TABLE_DISPOSITION — ` +
        `add "repointed" (and wire it into mergeDb.ts's mergeContacts/unmergeContact) or an { excluded: "..." } reason`,
    );
  }
});

test("MERGE_REPOINTED_TABLES matches every table this guard marks 'repointed' (the two lists must never drift apart)", () => {
  const repointedInDisposition = Object.entries(PERSON_FK_TABLE_DISPOSITION)
    .filter(([, d]) => d === "repointed")
    .map(([name]) => name)
    .sort();
  assert.deepEqual([...MERGE_REPOINTED_TABLES].sort(), repointedInDisposition);
});

test("every table marked 'repointed' still actually has a person_id-style FK to person.id (no stale entries)", () => {
  for (const name of MERGE_REPOINTED_TABLES) {
    const tableExport = Object.values(schema).find((value) => {
      if (!value || typeof value !== "object") return false;
      try {
        return getTableConfig(value as Parameters<typeof getTableConfig>[0]).name === name;
      } catch {
        return false;
      }
    });
    assert.ok(tableExport, `no schema export found for table "${name}"`);
    const config = getTableConfig(tableExport as Parameters<typeof getTableConfig>[0]);
    const hasPersonFk = config.foreignKeys.some((fk) => fk.reference().foreignTable === schema.person);
    assert.ok(hasPersonFk, `"${name}" is marked "repointed" but no longer has a column referencing person.id — update this guard`);
  }
});
