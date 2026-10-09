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
  parseKeyList,
  resolveExplicitKeys,
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

const fromFile = (...values: string[]) => values.map((value) => ({ value, fromFile: true }));
const fromKeyArg = (...values: string[]) => values.map((value) => ({ value, fromFile: false }));

test("parseKeyList reads one key per line, skips blanks and # comments, dedupes, and never mutates its input", () => {
  const lines = fromFile("# confirmed by the owner", "", "  profesional independiente ", "consultor independiente", "profesional independiente");
  const before = structuredClone(lines);
  assert.deepEqual(parseKeyList(lines), ["profesional independiente", "consultor independiente"]);
  assert.deepEqual(lines, before);
  assert.deepEqual(parseKeyList(lines), parseKeyList(lines));
  assert.throws(() => parseKeyList(fromFile("# only a comment", "")), /at least one/);
});

test("a --key that starts with '#' is a key, not a comment: production holds '#ono (open to new opportunities)'", () => {
  // The bug this pins: --key values used to share the file lines' array, so the `#` filter ate them. Beside other
  // keys the loss was SILENT -- the key never reached resolveExplicitKeys, so it was not reported as unknown either.
  assert.deepEqual(parseKeyList(fromKeyArg("#ono (open to new opportunities)")), ["#ono (open to new opportunities)"]);
  assert.deepEqual(
    parseKeyList([...fromKeyArg("open to work", "#ono (open to new opportunities)", "ex: navent and quintoandar")]),
    ["open to work", "#ono (open to new opportunities)", "ex: navent and quintoandar"],
  );
  // The file rule is untouched: there `#` still opens a comment.
  assert.throws(() => parseKeyList(fromFile("#ono (open to new opportunities)")), /at least one/);
  // Mixed sources keep each rule: the file comment goes, the --key stays.
  assert.deepEqual(
    parseKeyList([...fromFile("# a note"), ...fromKeyArg("#ono (open to new opportunities)")]),
    ["#ono (open to new opportunities)"],
  );
});

test("a CRLF-authored file survives a split on \\n alone: the trailing \\r is trimmed off keys and comments alike", () => {
  // The script splits --file content on "\n", so a Windows-authored list leaves "\r" on every line. That works only
  // because the trim runs before both the comment check and the dedupe; without it every key would miss by one byte.
  assert.deepEqual(parseKeyList(fromFile("open to work\r", "# a note\r", "open to work\r")), ["open to work"]);
});

test("an explicit list acts only on the listed keys that exist; one that matches nothing is reported, not ignored", () => {
  const existing = new Set(["profesional independiente", "freelance", "acme"]);
  const r = resolveExplicitKeys(["profesional independiente", "profesional independente"], existing);
  assert.deepEqual(r, { keys: ["profesional independiente"], unknown: ["profesional independente"] });
});

test("the built-in matcher is untouched: it still does not catch PROFESIONAL INDEPENDIENTE, which only an explicit list can", () => {
  assert.equal(isNonCompanyEmployer("profesional independiente"), false);
  assert.equal(isNonCompanyEmployer("freelance"), true);
});

test("an explicitly listed key that is not a matcher variant still hits the refusal list", () => {
  const counts = buildRefCounts([{ t: "task", k: "profesional independiente", n: 2 }, { t: "person", k: "profesional independiente", n: 152 }]);
  assert.equal(isNonCompanyEmployer("profesional independiente"), false);
  assert.deepEqual(cascadeBlockers(counts, ["profesional independiente"]), ["task: 2 row(s)"]);
});
