import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/db/schema";
import {
  buildRefCounts,
  COMPANY_KEY_TABLES,
  refCount,
  squashCompanyKey,
} from "../../src/lib/companyMerge/keys";
import {
  findBlockers,
  groupCandidates,
  mergeCompanyFields,
  movedRowCounts,
  parseGroupJson,
  parseGroupLines,
  parseGroupSpec,
  planMerge,
  STAGE_STRENGTH,
  strongestStage,
  type CompanyRow,
  type MergeContext,
} from "../../src/lib/companyMerge/plan";

const row = (companyKey: string, over: Partial<CompanyRow> = {}): CompanyRow => ({
  companyKey,
  displayName: companyKey,
  relationshipStage: "prospect",
  revenuePotential: null,
  notes: null,
  domain: null,
  industry: null,
  ownerBdId: null,
  city: null,
  country: null,
  accountType: null,
  clientStatus: null,
  linkedinUrl: null,
  ...over,
});

test("stage ranking is won > proposal_sent > qualified > prospect > lost", () => {
  assert.deepEqual([...STAGE_STRENGTH], ["won", "proposal_sent", "qualified", "prospect", "lost"]);
});

test("strongestStage: every ordered pair picks the stronger one, in either argument order", () => {
  STAGE_STRENGTH.forEach((strong, i) => {
    STAGE_STRENGTH.slice(i + 1).forEach((weak) => {
      assert.equal(strongestStage(strong, weak), strong, `${strong} vs ${weak}`);
      assert.equal(strongestStage(weak, strong), strong, `${weak} vs ${strong}`);
    });
  });
  assert.equal(strongestStage("won", "lost"), "won");
  assert.equal(strongestStage("lost", "won"), "won");
});

test("strongestStage: a stated stage beats none or an unknown value; a tie keeps the first argument", () => {
  assert.equal(strongestStage(null, "lost"), "lost");
  assert.equal(strongestStage("weird", "prospect"), "prospect");
  assert.equal(strongestStage("prospect", null), "prospect");
  assert.equal(strongestStage(null, null), null);
  assert.equal(strongestStage("weird", "odd"), "weird");
});

test("squashCompanyKey drops everything but a-z0-9 after lowercasing", () => {
  assert.equal(squashCompanyKey("Mercado Libre"), "mercadolibre");
  assert.equal(squashCompanyKey("mercado-libre."), "mercadolibre");
  // The known false positive: the heuristic proposes, a human decides.
  assert.equal(squashCompanyKey("&company"), squashCompanyKey("Company"));
  assert.equal(squashCompanyKey("---"), "");
});

test("parseGroupSpec reads survivor and dead keys, trimmed", () => {
  assert.deepEqual(parseGroupSpec(" mercado libre : mercadolibre , ml inc "), {
    survivorKey: "mercado libre",
    deadKeys: ["mercadolibre", "ml inc"],
  });
});

test("parseGroupSpec rejects malformed specs", () => {
  assert.throws(() => parseGroupSpec("only-survivor"), /survivor:dead/);
  assert.throws(() => parseGroupSpec("a:"), /survivor:dead/);
  assert.throws(() => parseGroupSpec("a:b:c"), /survivor:dead/);
  assert.throws(() => parseGroupSpec("a:a"), /itself/);
});

test("parseGroupLines skips blanks and comments and rejects a key used twice", () => {
  const groups = parseGroupLines(["# header", "", "a:b", "c:d,e"]);
  assert.equal(groups.length, 2);
  assert.throws(() => parseGroupLines(["a:b", "c:b"]), /more than once/);
  assert.throws(() => parseGroupLines(["a:b", "b:c"]), /more than once/);
  assert.throws(() => parseGroupLines([]), /at least one/);
});

test("mergeCompanyFields: won on the dead record wins even though the survivor keeps the row", () => {
  const r = mergeCompanyFields(row("a", { relationshipStage: "qualified" }), [row("b", { relationshipStage: "won" })]);
  assert.equal(r.merged.relationshipStage, "won");
  assert.deepEqual(r.changes, [{ field: "relationshipStage", oldValue: "qualified", newValue: "won" }]);
  // The survivor's weaker stage is the value thrown away; it is counted, not silent.
  assert.deepEqual(r.discarded, [{ deadKey: "b", field: "relationshipStage", value: "qualified" }]);
});

test("mergeCompanyFields: the survivor's won is never lost to a weaker dead stage, and the loser is counted", () => {
  const r = mergeCompanyFields(row("a", { relationshipStage: "won" }), [row("b", { relationshipStage: "lost" })]);
  assert.equal(r.merged.relationshipStage, "won");
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.discarded, [{ deadKey: "b", field: "relationshipStage", value: "lost" }]);
});

test("mergeCompanyFields: a dead value only fills a blank; a blank includes whitespace-only text", () => {
  const r = mergeCompanyFields(row("a", { industry: "  ", city: "Lima" }), [
    row("b", { industry: "Retail", city: "Quito", country: "PE" }),
  ]);
  assert.equal(r.merged.industry, "Retail");
  assert.equal(r.merged.city, "Lima");
  assert.equal(r.merged.country, "PE");
  assert.deepEqual(r.discarded, [{ deadKey: "b", field: "city", value: "Quito" }]);
  assert.deepEqual(
    r.changes.map((c) => c.field),
    ["industry", "country"],
  );
});

test("mergeCompanyFields: equal values are not discards; notes are counted but their text is withheld", () => {
  const r = mergeCompanyFields(row("a", { domain: "x.com", notes: "ours" }), [row("b", { domain: "x.com", notes: "theirs" })]);
  assert.deepEqual(r.discarded, [{ deadKey: "b", field: "notes", value: null }]);
});

test("mergeCompanyFields: with two dead records the first fills, the second's different value is discarded", () => {
  const r = mergeCompanyFields(row("a"), [row("b", { country: "PE" }), row("c", { country: "CL" })]);
  assert.equal(r.merged.country, "PE");
  assert.deepEqual(r.discarded, [{ deadKey: "c", field: "country", value: "CL" }]);
});

test("mergeCompanyFields never mutates its inputs and is repeatable", () => {
  const survivor = row("a", { relationshipStage: "lost" });
  const deads = [row("b", { relationshipStage: "won", city: "Lima" })];
  const before = JSON.stringify({ survivor, deads });
  const first = mergeCompanyFields(survivor, deads);
  const second = mergeCompanyFields(survivor, deads);
  assert.equal(JSON.stringify({ survivor, deads }), before);
  assert.deepEqual(first, second);
});

test("planMerge: fails loudly on a key with no company row, and is repeatable without mutating the map", () => {
  const companies = new Map([["a", row("a", { relationshipStage: "won" })], ["b", row("b")]]);
  const groups = [{ survivorKey: "a", deadKeys: ["b"] }];
  const before = JSON.stringify([...companies]);
  assert.deepEqual(planMerge(groups, companies), planMerge(groups, companies));
  assert.equal(JSON.stringify([...companies]), before);
  assert.throws(() => planMerge([{ survivorKey: "a", deadKeys: ["zzz"] }], companies), /zzz/);
});

test("ref counts: the consumer reads exactly what the producer wrote", () => {
  const counts = buildRefCounts([
    { t: "person", k: "b", n: "3" },
    { t: "activity", k: "b", n: 2 },
  ]);
  assert.equal(refCount(counts, "person", "b"), 3);
  assert.equal(refCount(counts, "activity", "b"), 2);
  assert.equal(refCount(counts, "task", "b"), 0);
});

test("movedRowCounts sums dead keys per table and never counts the survivor's rows", () => {
  const counts = buildRefCounts([
    { t: "person", k: "a", n: 100 },
    { t: "person", k: "b", n: 3 },
    { t: "person", k: "c", n: 4 },
  ]);
  const plans = planMerge([{ survivorKey: "a", deadKeys: ["b", "c"] }], new Map(["a", "b", "c"].map((k) => [k, row(k)])));
  assert.equal(movedRowCounts(plans, counts).person, 7);
});

const ctx = (over: Partial<MergeContext> = {}): MergeContext => ({
  targetKeys: new Set(),
  aliasTargets: new Map(),
  aliasFkToTarget: true,
  ...over,
});
const onePlan = () => planMerge([{ survivorKey: "a", deadKeys: ["b"] }], new Map(["a", "b"].map((k) => [k, row(k)])));

test("findBlockers: the alias FK to target_company blocks when neither record is a target company", () => {
  assert.match(findBlockers(onePlan(), ctx()).join(" "), /migration/);
  assert.deepEqual(findBlockers(onePlan(), ctx({ aliasFkToTarget: false })), []);
  assert.deepEqual(findBlockers(onePlan(), ctx({ targetKeys: new Set(["a"]) })), []);
  assert.deepEqual(findBlockers(onePlan(), ctx({ targetKeys: new Set(["b"]) })), []);
});

test("findBlockers: a dead key that is already an alias of some OTHER company blocks the group", () => {
  const base = { aliasFkToTarget: false };
  assert.match(findBlockers(onePlan(), ctx({ ...base, aliasTargets: new Map([["b", "zzz"]]) })).join(" "), /already an alias/);
  assert.deepEqual(findBlockers(onePlan(), ctx({ ...base, aliasTargets: new Map([["b", "a"]]) })), []);
});

test("every table with a company_key column in the schema is in the merge registry, and vice versa", () => {
  const withKey = Object.values(schema)
    .filter((v) => v instanceof PgTable)
    .map((t) => getTableConfig(t as PgTable))
    .filter((c) => c.columns.some((col) => col.name === "company_key"))
    .map((c) => c.name)
    .sort();
  assert.deepEqual(withKey, [...COMPANY_KEY_TABLES].sort());
});

test("groupCandidates: groups by squash, biggest group first, suggests the record with most contacts and never mutates", () => {
  const rec = (companyKey: string, contacts: number, squash: string) => ({ companyKey, displayName: companyKey, stage: null, domain: null, contacts, squash });
  const input = [rec("ml", 2, "ml"), rec("m l", 5, "ml"), rec("zz", 1, "zz"), rec("z z", 1, "zz"), rec("solo", 9, "solo")];
  const before = JSON.stringify(input);
  const groups = groupCandidates(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(groups.map((g) => [g.squash, g.contacts, g.records[0]!.companyKey]), [["ml", 7, "m l"], ["zz", 2, "z z"]]);
  assert.deepEqual(groupCandidates(input), groups);
});

test("parseGroupJson: a key containing ':' (and ',') round-trips, which the line format cannot express", () => {
  const text = JSON.stringify([{ survivor: "quares :: it solutions", dead: ["quares it solutions", "a, b"] }]);
  assert.deepEqual(parseGroupJson(text), [{ survivorKey: "quares :: it solutions", deadKeys: ["quares it solutions", "a, b"] }]);
});

test("the line format's refusal of ':' points at --json", () => {
  assert.throws(() => parseGroupSpec("quares :: it solutions:quares it solutions"), /--json/);
});

test("parseGroupJson refuses malformed input with the entry it found it in", () => {
  assert.throws(() => parseGroupJson("not json"), /not valid JSON/);
  assert.throws(() => parseGroupJson('{"survivor":"a"}'), /array/);
  assert.throws(() => parseGroupJson('[{"survivor":"a","dead":["b"]},{"survivor":"c"}]'), /entry 2/);
  assert.throws(() => parseGroupJson('[{"survivor":"a","dead":["b",""]}]'), /entry 1/);
  assert.throws(() => parseGroupJson('[{"survivor":"a","dead":["a"]}]'), /entry 1.*itself/);
  assert.throws(() => parseGroupJson("[]"), /at least one/);
});

test("parseGroupJson applies the same cross-group rule: a key may appear once", () => {
  assert.throws(() => parseGroupJson('[{"survivor":"a","dead":["b"]},{"survivor":"c","dead":["b"]}]'), /more than once/);
});

test("the existing line formats are unchanged", () => {
  assert.deepEqual(parseGroupLines(["a:b,c", "# x", "d:e"]), [{ survivorKey: "a", deadKeys: ["b", "c"] }, { survivorKey: "d", deadKeys: ["e"] }]);
});
