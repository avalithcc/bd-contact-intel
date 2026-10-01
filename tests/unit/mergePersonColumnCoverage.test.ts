/**
 * Guard test (merge data-loss): a merge carries a fixed set of `person`
 * columns onto the survivor (MERGE_TRACKED_FIELDS in
 * src/lib/identity/merge.ts). `phone`/`mobile_phone` and `profile_key` were
 * each found missing BY ACCIDENT, long after merges had silently dropped
 * them. This test enumerates EVERY column of the real `person` table
 * (drizzle's getTableColumns, no live DATABASE_URL needed) and forces an
 * explicit decision for each: carried, or not carried with a reason. A new
 * column fails this test until someone decides.
 *
 * It also ties the decisions to what planMerge really writes: the carried
 * set must equal the keys of `planMerge(...).survivorUpdate` and
 * MERGE_TRACKED_FIELDS, so a decision cannot drift from behavior.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableColumns } from "drizzle-orm";
import * as schema from "@/db/schema";
import { MERGE_TRACKED_FIELDS, planMerge, type MergePersonFields } from "@/lib/identity/merge";

type Decision = "carried" | { notCarried: string };

const PERSON_COLUMN_DECISION: Record<string, Decision> = {
  id: { notCarried: "row identity; the merged row keeps its own id" },
  profileKey: {
    notCarried:
      "deliberate: person_profile_key_unique forbids two rows sharing a key and a person can have merged two real LinkedIn profiles; conversations resolve through the merged_into_id chain (src/lib/identity/mergedProfileKeys.ts)",
  },
  firstName: "carried",
  lastName: "carried",
  email: "carried",
  emailNormalized: "carried",
  phone: "carried",
  mobilePhone: "carried",
  emailStatus: "carried",
  emailConfidence: "carried",
  emailSource: "carried",
  company: "carried",
  companyKey: "carried",
  companyCategory: "carried",
  jobTitle: "carried",
  roleGroup: "carried",
  seniority: "carried",
  industry: "carried",
  city: "carried",
  region: "carried",
  country: "carried",
  ownerBdId: "carried",
  status: { notCarried: "cache recomputed by recomputePersonStatuses after every merge" },
  statusActivityId: { notCarried: "cache recomputed together with status" },
  sourceKey: "carried",
  contactType: "carried",
  mergedIntoId: { notCarried: "written onto the MERGED row by the merge itself, never copied" },
  migrationRunId: { notCarried: "provenance of the survivor's own creation" },
  createdAt: { notCarried: "survivor keeps its own creation time" },
  updatedAt: { notCarried: "stamped by mergeContacts at write time" },
  updatedByBdId: { notCarried: "stamped by edits, not by merges" },
};

function fields(id: string): MergePersonFields {
  return {
    id,
    firstName: "A",
    lastName: "B",
    email: null,
    emailNormalized: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    phone: null,
    mobilePhone: null,
    company: null,
    companyKey: null,
    companyCategory: null,
    jobTitle: null,
    roleGroup: null,
    seniority: null,
    industry: null,
    city: null,
    region: null,
    country: null,
    ownerBdId: null,
    sourceKey: null,
    contactType: null,
  };
}

const columnKeys = Object.keys(getTableColumns(schema.person));
const carried = Object.entries(PERSON_COLUMN_DECISION)
  .filter(([, d]) => d === "carried")
  .map(([k]) => k)
  .sort();

test("every person column has an explicit carry / do-not-carry decision", () => {
  const undecided = columnKeys.filter((k) => !(k in PERSON_COLUMN_DECISION));
  assert.deepEqual(undecided, [], `person column(s) with no merge decision: ${undecided.join(", ")} - add to PERSON_COLUMN_DECISION`);
});

test("no decision refers to a column that no longer exists", () => {
  const stale = Object.keys(PERSON_COLUMN_DECISION).filter((k) => !columnKeys.includes(k));
  assert.deepEqual(stale, []);
});

test("every not-carried decision gives a reason", () => {
  for (const [k, d] of Object.entries(PERSON_COLUMN_DECISION)) {
    if (d !== "carried") assert.ok(d.notCarried.trim().length > 10, `${k} needs a reason`);
  }
});

test("the carried decisions equal MERGE_TRACKED_FIELDS and what planMerge writes", () => {
  const plan = planMerge({
    survivor: fields("s"),
    merged: fields("m"),
    survivorConnections: [],
    mergedConnections: [],
    referencesOnMerged: [],
    idMapRowsOnMerged: [],
    duplicateCandidatesInvolvingMerged: [],
    survivorPairedPersonIds: [],
    emailMessagePersonRowsOnMerged: [],
    survivorEmailMessagePersonRows: [],
    queueItemRowsOnMerged: [],
    survivorQueueItemRows: [],
  });
  assert.deepEqual([...MERGE_TRACKED_FIELDS].sort(), carried);
  assert.deepEqual(Object.keys(plan.survivorUpdate).sort(), carried);
});
