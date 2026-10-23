import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { INDUSTRY_GROUPS, KNOWN_INDUSTRY_VALUES } from "@/lib/sequences/industryGroups";
import { DEFAULT_PICKER_QUERY, PICKER_INDUSTRY_MAX, normalizePickerQuery, pickerQueryKey, type PickerQuery } from "@/lib/sequences/pickerFilters";
import { buildPickerIndustryCountsQuery, buildPickerPageQuery, buildPickerPoolSql, buildPickerReads } from "@/lib/sequences/pickerQuery";
import { industryCountsFromRows, groupCount, type IndustryCounts } from "@/lib/sequences/industryCounts";

const ME = "00000000-0000-4000-8000-000000000001";
const facts = { unmapped: ["atlantis"], us: ["united states"] };
const TECH = INDUSTRY_GROUPS.tecnologia;
const dialect = new PgDialect();
const flat = (s: string) => s.replace(/\s+/g, " ").replace(/\$\d+/g, "?");
const rendered = (s: SQL) => { const q = dialect.sqlToQuery(s); return { text: flat(q.sql), params: q.params }; };
const list = (over: Partial<PickerQuery> = {}) => rendered(buildPickerPageQuery({ ...DEFAULT_PICKER_QUERY, ...over }, ME, facts));
const counts = (over: Partial<PickerQuery> = {}) => rendered(buildPickerIndustryCountsQuery({ ...DEFAULT_PICKER_QUERY, ...over }, ME, facts));
const region = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

// ---- normalizePickerQuery ----

test("the default query has no industry selection", () => {
  assert.deepEqual(normalizePickerQuery({}).industries, []);
  assert.equal(normalizePickerQuery({}).noIndustry, false);
  assert.deepEqual(DEFAULT_PICKER_QUERY.industries, []);
  assert.equal(DEFAULT_PICKER_QUERY.noIndustry, false);
});

test("known raw values survive; unknown values, wrong types and duplicates are dropped; order is canonical", () => {
  const n = normalizePickerQuery({ industries: [TECH[2], "Not an industry", 7, null, TECH[0], TECH[2], { x: 1 }] });
  assert.deepEqual(n.industries, [TECH[0], TECH[2]].sort());
  assert.deepEqual(normalizePickerQuery({ industries: "Software de ordenador" }).industries, [], "a bare string is not an array");
  assert.deepEqual(normalizePickerQuery({ industries: { 0: TECH[0] } }).industries, []);
  assert.deepEqual(normalizePickerQuery({ industries: ["tecnologia"] }).industries, [], "a group KEY is not a raw value: the query carries what it filters on");
  assert.deepEqual(normalizePickerQuery({ industries: [TECH[0].toUpperCase()] }).industries, [], "exact match");
});

test("an oversized array is bounded before it is looked at", () => {
  const huge = Array.from({ length: 10_000 }, (_, i) => `junk ${i}`);
  assert.deepEqual(normalizePickerQuery({ industries: huge }).industries, []);
  const padded = [...huge.slice(0, PICKER_INDUSTRY_MAX), TECH[0]];
  assert.deepEqual(normalizePickerQuery({ industries: padded }).industries, [], "a real value beyond the cap is not read");
  const everything = normalizePickerQuery({ industries: [...KNOWN_INDUSTRY_VALUES, ...KNOWN_INDUSTRY_VALUES] }).industries;
  assert.equal(everything.length, KNOWN_INDUSTRY_VALUES.size);
});

test("noIndustry is true only for the boolean true", () => {
  assert.equal(normalizePickerQuery({ noIndustry: true }).noIndustry, true);
  for (const v of [1, "true", "yes", null, undefined, {}, []]) assert.equal(normalizePickerQuery({ noIndustry: v }).noIndustry, false);
});

test("pickerQueryKey changes with every part of the industry selection, and not with its order", () => {
  const base = pickerQueryKey(DEFAULT_PICKER_QUERY);
  const a = pickerQueryKey({ ...DEFAULT_PICKER_QUERY, industries: [TECH[0]] });
  const b = pickerQueryKey({ ...DEFAULT_PICKER_QUERY, industries: [TECH[0], TECH[1]] });
  const none = pickerQueryKey({ ...DEFAULT_PICKER_QUERY, noIndustry: true });
  assert.equal(new Set([base, a, b, none]).size, 4);
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, industries: [TECH[1], TECH[0]] }), b);
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, industries: [TECH[0]], offset: 50 }), a, "paging is still not part of the identity");
});

// ---- the SQL ----

test("no selection adds no industry predicate; a selection narrows by the company's industry", () => {
  assert.doesNotMatch(list().text, /industry/);
  const t = list({ industries: [TECH[0], TECH[1]] });
  assert.match(t.text, /coalesce\(nullif\(btrim\(cn\.industry\), ''\), nullif\(btrim\(cca\.industry\), ''\)\) = any\(array\[\?, \?\]::text\[\]\)/);
  assert.ok(t.params.includes(TECH[0]) && t.params.includes(TECH[1]));
});

test("the industry follows the TWO paths of the company country: own row first, then the alias target", () => {
  const t = list({ industries: [TECH[0]] }).text;
  assert.match(t, /nullif\(btrim\(cn\.industry\), ''\)/, "own company row");
  assert.match(t, /nullif\(btrim\(cca\.industry\), ''\)/, "canonical company reached through company_alias");
  assert.match(t, /left join company cca on cca\.company_key = ca\.company_key and cca\.company_key <> p\.company_key/);
  assert.ok(t.indexOf("cn.industry") < t.indexOf("cca.industry"), "own row wins");
});

test("'no industry' is its own predicate, not 'no filter', and combines with groups as a union", () => {
  const none = list({ noIndustry: true }).text;
  assert.match(none, /coalesce\(nullif\(btrim\(cn\.industry\), ''\), nullif\(btrim\(cca\.industry\), ''\)\) is null/);
  assert.notEqual(none, list().text);
  const both = list({ noIndustry: true, industries: [TECH[0]] }).text;
  assert.match(both, /= any\(array\[\?\]::text\[\]\) or .* is null\)/);
});

test("the industry filter only narrows: the eligibility predicates stay, in front of and behind it", () => {
  const plain = region(list().text, " where ", " order by");
  const narrowed = region(list({ industries: [TECH[0]] }).text, " where ", " order by");
  const cut = plain.indexOf(" and not ");
  assert.ok(cut > 0 && plain.includes("p.merged_into_id is null and btrim(coalesce(p.email, '')) <> ''"));
  assert.ok(narrowed.startsWith(plain.slice(0, cut)), "the head of the WHERE is untouched");
  assert.ok(narrowed.endsWith(plain.slice(cut)), "the blocked / eligibility tail is untouched");
  assert.ok(narrowed.length > plain.length);
});

// ---- counts cannot diverge from the list ----

/** One variant per key of DEFAULT_PICKER_QUERY, each key set to a non-default value of its type. A new key with a type this does not know THROWS, so adding a PickerQuery field forces the author to account for it here. */
const nonDefault = (key: string, v: unknown): unknown => {
  if (typeof v === "boolean") return !v;
  if (typeof v === "string") return "ana perez";
  if (typeof v === "number") return 100;
  if (Array.isArray(v)) return [TECH[0]];
  throw new Error(`PickerQuery.${key} has a type the matrix cannot vary: teach it here and decide how the counts treat it`);
};
const KEYS = Object.keys(DEFAULT_PICKER_QUERY) as (keyof PickerQuery)[];
const exercised = new Set<string>();
const MATRIX: Partial<PickerQuery>[] = [
  {},
  ...KEYS.map((k) => { exercised.add(k); return { [k]: nonDefault(k, DEFAULT_PICKER_QUERY[k]) } as Partial<PickerQuery>; }),
  Object.fromEntries(KEYS.map((k) => [k, nonDefault(k, DEFAULT_PICKER_QUERY[k])])) as Partial<PickerQuery>,
];
const INDUSTRY_KEYS = new Set<string>(["industries", "noIndustry"]);
const withoutIndustry = (over: Partial<PickerQuery>): Partial<PickerQuery> => ({ ...over, industries: [], noIndustry: false });

test("the matrix covers every PickerQuery key", () => {
  assert.deepEqual([...exercised].sort(), Object.keys(DEFAULT_PICKER_QUERY).sort());
  assert.ok(MATRIX.length >= KEYS.length + 2);
});

test("the counts query reads the list's pool character for character, for every key, industry lifted: FROM .. WHERE, params included", () => {
  for (const over of MATRIX) {
    const l = list(over);
    const c = counts(over);
    assert.equal(region(c.text, " from person p", " group by"), region(list(withoutIndustry(over)).text, " from person p", " order by"), JSON.stringify(over));
    assert.ok(c.text.includes("with pk_jf as") && l.text.includes("with pk_jf as"), "same CTE");
    const pool = rendered(buildPickerPoolSql({ ...DEFAULT_PICKER_QUERY, ...over, industries: [], noIndustry: false }, ME, facts));
    assert.ok(c.text.includes(pool.text), "the counts are built from the pool fragment");
    const sub = (all: readonly unknown[]) => all.join("\u0001").includes(pool.params.join("\u0001"));
    assert.ok(sub(c.params), "and bind the same parameters");
    if (!Object.keys(over).some((k) => INDUSTRY_KEYS.has(k))) assert.ok(l.text.includes(pool.text), "the list is built from the pool fragment");
  }
});

test("a selection narrows the list but never the chip counts: the counts ignore the industry, the list obeys it", () => {
  for (const over of MATRIX) {
    const picked = { industries: [TECH[0]], noIndustry: true };
    assert.deepEqual(counts({ ...over, ...picked }), counts(withoutIndustry(over)), "the counts are the same with or without an industry selection");
    assert.notEqual(list({ ...over, ...picked }).text, list(withoutIndustry(over)).text, "the list does obey it");
  }
});

// ---- the call site: one request, one query, both reads ----

const reads = (over: Partial<PickerQuery>) => {
  const r = buildPickerReads({ ...DEFAULT_PICKER_QUERY, ...over }, ME, facts);
  return { page: rendered(r.page), counts: r.counts && rendered(r.counts) };
};

test("one request builds the page AND the counts from the same query: the counts describe the list on screen, for every key", () => {
  for (const over of MATRIX.filter((o) => !("offset" in o))) {
    const r = reads(over);
    assert.ok(r.counts, JSON.stringify(over));
    assert.equal(region(r.counts.text, " from person p", " group by"), region(reads(withoutIndustry(over)).page.text, " from person p", " order by"), JSON.stringify(over));
    assert.deepEqual(r.counts, counts(over), "and it is exactly the counts statement for that query");
  }
});

test("counts built for the DEFAULT query while the list follows another are caught (the static-prop bug)", () => {
  for (const over of MATRIX.filter((o) => !("offset" in o) && !Object.keys(o).every((k) => INDUSTRY_KEYS.has(k)))) {
    assert.notEqual(region(reads({}).counts!.text, " from person p", " group by"), region(reads(withoutIndustry(over)).page.text, " from person p", " order by"), `a default-query count would not match ${JSON.stringify(over)}`);
  }
});

test("only advancing the page skips the counts; any restart of the list recomputes them", () => {
  assert.equal(reads({ offset: 50 }).counts, null);
  assert.equal(reads({ offset: 50, florida: true }).counts, null);
  assert.ok(reads({ offset: 0, florida: true }).counts);
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, offset: 50 }), pickerQueryKey(DEFAULT_PICKER_QUERY), "offset-only is the same key: reuse");
  for (const k of KEYS.filter((k) => k !== "offset")) {
    assert.notEqual(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, [k]: nonDefault(k, DEFAULT_PICKER_QUERY[k]) } as PickerQuery), pickerQueryKey(DEFAULT_PICKER_QUERY), `${k} must restart the list, and with it the counts`);
  }
});

test("the page reads the counts through listPickerPage only: no second entry point with its own query", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(app)/sequences/new/page.tsx"), "utf8");
  assert.doesNotMatch(page, /IndustryCounts|buildPickerIndustryCountsQuery/);
  const queries = readFileSync(join(process.cwd(), "src/lib/sequences/pageQueries.ts"), "utf8");
  assert.equal((queries.match(/buildPickerReads\(/g) ?? []).length, 1);
  assert.doesNotMatch(queries, /buildPickerIndustryCountsQuery|buildPickerPageQuery/, "pageQueries cannot pair a page with counts of another query");
});

test("a predicate added to the list alone would be caught: every WHERE predicate sits in the shared pool fragment", () => {
  const l = list().text;
  assert.equal(region(l, " from person p", " order by"), region(counts().text, " from person p", " group by"));
  assert.ok(l.indexOf(" order by") > l.indexOf(" where "), "nothing filters after the pool");
  assert.doesNotMatch(l.slice(l.indexOf(" order by")), /\bwhere\b|\band\b/);
});

test("the counts are one bounded grouped statement over the same industry expression", () => {
  const c = counts().text;
  assert.equal((c.match(/\bselect\b[^()]*\bcount\(\*\)/g) ?? []).length >= 1, true);
  assert.match(c, /group by 1 order by n desc limit \?\s*$/, "biggest first, so a cap could only cut the smallest");
  assert.doesNotMatch(c, /offset/);
  assert.match(c, /coalesce\(nullif\(btrim\(cn\.industry\), ''\), nullif\(btrim\(cca\.industry\), ''\)\) as industry/);
});

// ---- the counts' shape ----

test("raw rows become per-value counts, a 'none' bucket, and group totals derived from the mapping", () => {
  const rows = [{ industry: TECH[0], n: "10" }, { industry: TECH[1], n: 5 }, { industry: INDUSTRY_GROUPS.finanzas[0], n: "3" }, { industry: null, n: "7" }, { industry: "Something new", n: "2" }];
  const c: IndustryCounts = industryCountsFromRows(rows);
  assert.equal(c.total, 27);
  assert.equal(c.none, 7);
  assert.equal(c.byValue[TECH[0]], 10);
  assert.equal(groupCount(c, "tecnologia"), 15);
  assert.equal(groupCount(c, "finanzas"), 3);
  assert.equal(groupCount(c, "salud"), 0);
  assert.equal(c.unmapped, 2, "a value the mapping does not know is counted apart, never hidden inside a group");
  assert.equal(Object.values(c.byValue).reduce((a, b) => a + b, 0) + c.none + c.unmapped, c.total);
});
