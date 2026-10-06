import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCompanyKey } from "../../src/lib/companyCategories";
import { buildRefCounts, COMPANY_KEY_TABLES } from "../../src/lib/companyMerge/keys";
import {
  cascadeBlockers,
  CLEARED_TABLES,
  CLEANUP_HISTORY_SOURCE,
  clearedHistoryRows,
  DELETED_TABLES,
  findNonCompanyKeys,
  isNonCompanyEmployer,
  STOP_TABLES,
} from "../../src/lib/nonCompanyEmployers/match";

// The variants the owner listed, run through the real key producer so the fixture cannot drift from production.
const LISTED = [
  "Freelance :: Self Employed",
  "Freelance (Self employed)",
  "Freelance / Self-employed",
  "Freelance | Self-Employed",
  "Freelance, self-employed",
  "Independiente (freelance)",
  "Independiente / Freelance",
];

test("every listed variant is caught once turned into its company_key", () => {
  for (const raw of LISTED) assert.equal(isNonCompanyEmployer(normalizeCompanyKey(raw)), true, raw);
});

test("a variant nobody listed is still caught", () => {
  for (const raw of ["Freelance", "Freelancer", "Independiente", "Independientes", "FREELANCE - Independiente", "free-lance", "Independiente/Self employed"]) {
    assert.equal(isNonCompanyEmployer(normalizeCompanyKey(raw)), true, raw);
  }
});

test("real companies that merely contain the word are not caught", () => {
  for (const raw of ["Freelance Studio", "Club Atletico Independiente", "Freelancer.com", "Independiente Medellin", "Self Employed", "", "---"]) {
    assert.equal(isNonCompanyEmployer(normalizeCompanyKey(raw)), false, raw);
  }
});

test("findNonCompanyKeys returns the unique matches, sorted, without touching its input", () => {
  const input = ["zeta", "freelance", "independiente freelance", "freelance", "acme"];
  const before = [...input];
  assert.deepEqual(findNonCompanyKeys(input), ["freelance", "independiente freelance"]);
  assert.deepEqual(input, before);
  assert.deepEqual(findNonCompanyKeys(input), findNonCompanyKeys(input));
});

test("cleared, deleted and stop tables partition the 14 company_key tables exactly", () => {
  const all = [...CLEARED_TABLES, ...DELETED_TABLES, ...STOP_TABLES].sort();
  assert.deepEqual(all, [...COMPANY_KEY_TABLES].sort());
});

test("cascadeBlockers: a company-scoped activity, task, signal or hiring row stops the run; cleared and deleted tables never do", () => {
  const counts = buildRefCounts([
    { t: "person", k: "freelance", n: 40 },
    { t: "contact", k: "freelance", n: 4 },
    { t: "company_property_history", k: "freelance", n: 2 },
    { t: "company_probe", k: "freelance", n: 1 },
  ]);
  assert.deepEqual(cascadeBlockers(counts, ["freelance"]), []);
  const withActivity = buildRefCounts([{ t: "activity", k: "freelance", n: "3" }, { t: "task", k: "other", n: 1 }]);
  assert.deepEqual(cascadeBlockers(withActivity, ["freelance", "other"]), ["activity: 3 row(s)", "task: 1 row(s)"]);
});

test("clearedHistoryRows: one row per property that held a value, new value null, never the sticky 'edit' source", () => {
  const cleared = [
    { id: "p1", company: "Freelance", companyKey: "freelance", companyCategory: null },
    { id: "p2", company: "Independiente", companyKey: "independiente", companyCategory: "Services" },
  ];
  const before = JSON.stringify(cleared);
  const rows = clearedHistoryRows(cleared, "bd1");
  assert.equal(JSON.stringify(cleared), before);
  assert.deepEqual(
    rows.map((r) => [r.personId, r.property, r.oldValue, r.newValue]),
    [["p1", "company", "Freelance", null], ["p1", "companyKey", "freelance", null], ["p2", "company", "Independiente", null], ["p2", "companyKey", "independiente", null], ["p2", "companyCategory", "Services", null]],
  );
  assert.ok(rows.every((r) => r.source === CLEANUP_HISTORY_SOURCE && (r.source as string) !== "edit" && r.changedByBdId === "bd1"));
});
