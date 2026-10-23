import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { DEFAULT_PICKER_QUERY, PICKER_COUNTRY_MAX, normalizePickerQuery, pickerQueryKey, type PickerQuery } from "@/lib/sequences/pickerFilters";
import { buildPickerCountsQuery, buildPickerPageQuery, buildPickerReads } from "@/lib/sequences/pickerQuery";
import { pickerCountsFromRows, splitCountries, type CountsRow } from "@/lib/sequences/pickerCounts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countryLabelEs, countryLabelsEs } from "@/lib/sequences/countryDisplay";

const ME = "00000000-0000-4000-8000-000000000001";
const facts = { unmapped: ["atlantis"], us: ["united states"] };
const dialect = new PgDialect();
const flat = (s: string) => s.replace(/\s+/g, " ").replace(/\$\d+/g, "?");
const rendered = (s: SQL) => { const q = dialect.sqlToQuery(s); return { text: flat(q.sql), params: q.params }; };
const list = (over: Partial<PickerQuery> = {}) => rendered(buildPickerPageQuery({ ...DEFAULT_PICKER_QUERY, ...over }, ME, facts));
const counts = (over: Partial<PickerQuery> = {}) => rendered(buildPickerCountsQuery({ ...DEFAULT_PICKER_QUERY, ...over }, ME, facts));
const region = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from))).trim();
const EFFECTIVE = "coalesce(nullif(btrim(p.country), ''), coalesce(nullif(btrim(cn.country), ''), nullif(btrim(cca.country), '')))";

// ---- normalizePickerQuery ----

test("the default query has no country selection", () => {
  assert.deepEqual(DEFAULT_PICKER_QUERY.countries, []);
  assert.equal(DEFAULT_PICKER_QUERY.noCountry, false);
  assert.deepEqual(normalizePickerQuery({}).countries, []);
  assert.equal(normalizePickerQuery({}).noCountry, false);
});

test("country values: strings only, trimmed, once each, canonical order; an unknown country is kept (it just matches nobody)", () => {
  const n = normalizePickerQuery({ countries: ["  Mexico ", "Argentina", "Argentina", 7, null, { x: 1 }, "", "   ", "Atlantis"] });
  assert.deepEqual(n.countries, ["Argentina", "Atlantis", "Mexico"]);
  assert.deepEqual(normalizePickerQuery({ countries: "Argentina" }).countries, [], "a bare string is not an array");
  assert.deepEqual(normalizePickerQuery({ countries: { 0: "Argentina" } }).countries, []);
  assert.deepEqual(normalizePickerQuery({ countries: ["argentina"] }).countries, ["argentina"], "no case folding: the value is what the counts returned");
});

test("an oversized array or value is bounded before it is used", () => {
  const huge = Array.from({ length: 10_000 }, (_, i) => `Country ${i}`);
  assert.ok(normalizePickerQuery({ countries: huge }).countries.length <= PICKER_COUNTRY_MAX);
  assert.deepEqual(normalizePickerQuery({ countries: [...huge.slice(0, PICKER_COUNTRY_MAX), "Argentina"] }).countries.includes("Argentina"), false, "a value beyond the cap is not read");
  assert.deepEqual(normalizePickerQuery({ countries: ["x".repeat(5_000)] }).countries, [], "an absurdly long text is not a country");
});

test("noCountry is true only for the boolean true", () => {
  assert.equal(normalizePickerQuery({ noCountry: true }).noCountry, true);
  for (const v of [1, "true", "yes", null, undefined, {}, [], 0, "false"]) assert.equal(normalizePickerQuery({ noCountry: v }).noCountry, false);
});

test("normalizing is idempotent and does not touch its input", () => {
  const input = { countries: ["Mexico", "Argentina", "Mexico"], noCountry: true };
  const copy = JSON.parse(JSON.stringify(input));
  const once = normalizePickerQuery(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(normalizePickerQuery(once), once);
});

test("pickerQueryKey changes with every part of the country selection, and not with its order", () => {
  const base = pickerQueryKey(DEFAULT_PICKER_QUERY);
  const a = pickerQueryKey({ ...DEFAULT_PICKER_QUERY, countries: ["Argentina"] });
  const b = pickerQueryKey({ ...DEFAULT_PICKER_QUERY, countries: ["Argentina", "Chile"] });
  const none = pickerQueryKey({ ...DEFAULT_PICKER_QUERY, noCountry: true });
  assert.equal(new Set([base, a, b, none]).size, 4);
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, countries: ["Chile", "Argentina"] }), b);
  assert.equal(pickerQueryKey({ ...DEFAULT_PICKER_QUERY, countries: ["Argentina"], offset: 50 }), a);
});

// ---- the SQL: one effective-country expression, union semantics ----

test("no selection adds no country predicate", () => {
  assert.ok(!list().text.includes(`<> '' and (${EFFECTIVE}`), "the country predicate follows the email check when present");
  assert.ok(list({ countries: ["Chile"] }).text.includes(`<> '' and (${EFFECTIVE} = any(`));
  assert.equal(list({ countries: [], noCountry: false }).text, list().text);
});

test("a selection narrows by the EFFECTIVE country: the person's own first, then the company's (own row, then alias target)", () => {
  const t = list({ countries: ["Argentina", "Chile"] });
  assert.ok(t.text.includes(`${EFFECTIVE} = any(array[?, ?]::text[])`), t.text);
  assert.ok(t.params.includes("Argentina") && t.params.includes("Chile"));
  const at = (s: string) => t.text.indexOf(s, t.text.indexOf(" where "));
  assert.ok(at("p.country") < at("cn.country") && at("cn.country") < at("cca.country"), "person, then own company row, then alias target");
});

test("'no country' is its own predicate (the same expression IS NULL), not 'no filter'", () => {
  const t = list({ noCountry: true }).text;
  assert.ok(t.includes(`${EFFECTIVE} is null`));
  assert.notEqual(t, list().text);
});

test("countries and 'no country' are a union; each alone is its own filter; both empty filters nothing", () => {
  const both = list({ countries: ["Chile"], noCountry: true }).text;
  assert.ok(both.includes(`(${EFFECTIVE} = any(array[?]::text[]) or ${EFFECTIVE} is null)`), both);
  const only = list({ countries: ["Chile"] }).text;
  const none = list({ noCountry: true }).text;
  assert.equal(new Set([both, only, none, list().text]).size, 4);
  assert.equal(list({ countries: [], noCountry: false }).text, list().text);
});

test("the country filter only ever NARROWS: the eligibility head and tail of the WHERE are untouched", () => {
  const plain = region(list().text, " where ", " order by");
  for (const over of [{ countries: ["Chile"] }, { noCountry: true }, { countries: ["Chile"], noCountry: true }]) {
    const narrowed = region(list(over).text, " where ", " order by");
    const cut = plain.indexOf(" and not ");
    assert.ok(narrowed.startsWith(plain.slice(0, cut)), "head");
    assert.ok(narrowed.endsWith(plain.slice(cut)), "blocked / eligibility tail");
    assert.ok(narrowed.length > plain.length, "and it ANDs something in");
    assert.ok(narrowed.includes(" and ("), "added with AND, never OR at the top level");
  }
});

// ---- the counts: both marginals in one pass, each with ITS OWN filter lifted and the other applied ----

test("one statement, grouping sets over industry and country, no second scan of person", () => {
  const c = counts().text;
  assert.match(c, /group by grouping sets \(\(ci_ind\), \(ci_pais\), \(\)\)/);
  assert.equal((c.match(/from person p/g) ?? []).length, 1, "the pool is scanned once");
  assert.match(c, /limit \?\s*$/);
});

test("the pool inside the counts has BOTH dimensions lifted; each marginal re-applies only the OTHER one, as a flag", () => {
  const poolOf = (over: Partial<PickerQuery>) => region(counts(over).text, " from person p", "), pk_grp as");
  const lifted = { industries: [], noIndustry: false, countries: [], noCountry: false };
  for (const over of [{ countries: ["Chile"] }, { noCountry: true }, { industries: ["Banca"] }, { florida: true, countries: ["Chile"], industries: ["Banca"] }]) {
    assert.equal(poolOf(over), region(list({ ...over, ...lifted }).text, " from person p", " order by"), JSON.stringify(over));
  }
  const withCountry = counts({ countries: ["Chile"] }).text;
  assert.ok(withCountry.includes(`(${EFFECTIVE} = any(array[?]::text[])) as ci_pais_ok`), "country selection becomes the flag the INDUSTRY marginal filters by");
  assert.match(withCountry, /true as ci_ind_ok/, "no industry selection: that flag is vacuous");
  const withIndustry = counts({ industries: ["Banca"] }).text;
  assert.match(withIndustry, /= any\(array\[\?\]::text\[\]\)\) as ci_ind_ok/);
  assert.match(withIndustry, /true as ci_pais_ok/);
  assert.match(withIndustry, /count\(\*\) filter \(where ci_pais_ok\) as ci_n_ind, count\(\*\) filter \(where ci_ind_ok\) as ci_n_pais/, "industry marginal obeys the country flag; country marginal obeys the industry flag");
});

test("the checkbox counts obey BOTH selections (a signal count that ignored them would lie under any chip)", () => {
  const c = counts({ countries: ["Chile"], industries: ["Banca"] }).text;
  assert.match(c, /count\(\*\) filter \(where ci_florida and ci_ind_ok and ci_pais_ok\) as ci_n_florida/);
  assert.match(c, /count\(\*\) filter \(where ci_hire and ci_ind_ok and ci_pais_ok\) as ci_n_hire/);
});

test("the country chips' own selection never changes the country counts; it does change the industry counts", () => {
  assert.equal(counts({ countries: ["Chile"] }).text.includes("ci_pais_ok"), true);
  const noCountrySel = counts({ industries: ["Banca"] });
  const withCountrySel = counts({ industries: ["Banca"], countries: ["Chile"] });
  assert.notDeepEqual(noCountrySel, withCountrySel, "the industry marginal now depends on the country selection");
  assert.equal(region(noCountrySel.text, " from person p", "), pk_grp as"), region(withCountrySel.text, " from person p", "), pk_grp as"), "but the scanned pool is the same");
});

test("the counts statement comes from buildPickerReads with the SAME query as the page, country included", () => {
  const q = { ...DEFAULT_PICKER_QUERY, countries: ["Chile"], noCountry: true, florida: true };
  const r = buildPickerReads(q, ME, facts);
  assert.deepEqual(rendered(r.counts!), counts(q));
  assert.deepEqual(rendered(r.page), list(q));
  assert.notDeepEqual(rendered(r.counts!), counts(), "counts for the default query would differ");
});

// ---- the counts' shape ----

test("rows become two independent breakdowns; the country one has the no-country bucket and a total", () => {
  const rows: CountsRow[] = [
    { dim: "industry", val: "Banca", n: "4" }, { dim: "industry", val: null, n: 2 },
    { dim: "country", val: "Argentina", n: "10" }, { dim: "country", val: "Chile", n: 5 }, { dim: "country", val: null, n: "3" },
  ];
  const c = pickerCountsFromRows(rows);
  assert.equal(c.industry.byValue["Banca"], 4);
  assert.equal(c.industry.none, 2);
  assert.deepEqual(c.country, { byValue: { Argentina: 10, Chile: 5 }, labels: {}, none: 3, total: 18 });
});

test("splitCountries: the biggest stay on top, a selected one is never hidden in the tail, even with no contacts left", () => {
  const byValue = { A: 50, B: 40, C: 30, D: 20, E: 10, F: 5, G: 4, H: 3, I: 2 };
  const s = splitCountries({ byValue, labels: {}, none: 0, total: 164 }, [], 3);
  assert.deepEqual(s.top.map((e) => e.value), ["A", "B", "C"]);
  assert.deepEqual(s.tail.map((e) => e.value), ["D", "E", "F", "G", "H", "I"]);
  const picked = splitCountries({ byValue, labels: {}, none: 0, total: 164 }, ["I", "Z"], 3);
  assert.deepEqual(picked.top.map((e) => e.value), ["A", "B", "C", "I", "Z"]);
  assert.equal(picked.top.at(-1)!.n, 0, "a selected country with no contacts under the other filters shows 0");
  assert.equal(picked.tail.some((e) => e.value === "I"), false);
});

test("splitCountries does not mutate its inputs", () => {
  const counts = { byValue: { A: 1, B: 2 }, labels: {}, none: 0, total: 3 };
  const selected = ["B"];
  const a = splitCountries(counts, selected, 1);
  const b = splitCountries(counts, selected, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(counts, { byValue: { A: 1, B: 2 }, labels: {}, none: 0, total: 3 });
  assert.deepEqual(selected, ["B"]);
});

test("the Spanish label resolves the English names the data holds and leaves anything else untouched", () => {
  assert.equal(countryLabelEs("United States"), "Estados Unidos");
  assert.equal(countryLabelEs("Mexico"), "México");
  assert.equal(countryLabelEs("Argentina"), "Argentina");
  assert.equal(countryLabelEs("Narnia"), "Narnia");
});

// ---- the picker: country chips, the tail, and the three signals as checkboxes ----

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RosterPicker } = require("@/app/(app)/sequences/_components/RosterPicker") as typeof import("@/app/(app)/sequences/_components/RosterPicker");
const countryCounts = { labels: countryLabelsEs(["Argentina", "United States", "Mexico", "Spain", "USA", "Brasil"]), byValue: { Argentina: 2264, "United States": 494, Mexico: 496, Colombia: 345, Chile: 213, Uruguay: 167, Spain: 130, Ecuador: 113, "Costa Rica": 75 }, none: 860, total: 4857 };
const picker = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(RosterPicker, { contacts: [], hasMore: false, loadPage: async () => ({ contacts: [], hasMore: false }), selection: new Map(), onChange: () => {}, labels: es.sequences, statusLabels: es.leadStatuses, ...extra }));

test("country chips: biggest first with their counts, in Spanish, 'Sin país', the tail collapsed behind a toggle that counts them all", () => {
  const out = picker({ countryCounts });
  assert.match(out, /Argentina <span class="meta">2264<\/span>/);
  assert.match(out, /México <span class="meta">496<\/span>/);
  assert.match(out, /Sin país <span class="meta">860<\/span>/);
  assert.ok(out.indexOf("Argentina") < out.indexOf("México") && out.indexOf("México") < out.indexOf("Estados Unidos"));
  assert.match(out, /aria-expanded="false"[^>]*aria-controls="pick-country-tail"[^>]*>Ver los 9 países</);
  assert.match(out, /id="pick-country-tail" class="row wrap" hidden=""><button[^>]*>Ecuador/, "the tail chips exist (and filter), collapsed");
  assert.ok(!picker().includes("Sin país"), "without counts there is no country row");
});

test("Florida, hiring and mine are checkboxes below the chips: unticked, counted (mine is not), and no longer chips", () => {
  const out = picker({ countryCounts, signalCounts: { florida: 65, hiring: 8 } });
  assert.match(out, /<label class="check"><input type="checkbox"[^>]*\/> Solo mis contactos<\/label>/);
  assert.match(out, /Florida \/ Miami <span class="meta">65<\/span>/);
  assert.match(out, /Con vacante IT abierta en EE\. UU\. <span class="meta">8<\/span>/);
  assert.ok(!/class="chip"[^>]*>(Florida|Solo mis|Con vacante)/.test(out));
  assert.ok(out.indexOf("Sin país") < out.indexOf("Solo mis contactos"), "signals sit below the dimensions");
  assert.doesNotMatch(out, /Solo mis contactos <span/, "mine depends on the viewer: no count");
});

// ---- labels are resolved on the server ----

test("the server resolves the labels and leaves unrecognised values as stored (no entry = shown as stored)", () => {
  const labels = countryLabelsEs(["United States", "Mexico", "Argentina", "USA", "Brasil", "Bolivia, Plurinational State of"]);
  assert.deepEqual(labels, { "United States": "Estados Unidos", Mexico: "México" }, "only renamed values; Argentina is the same word, the rest are unknown to Intl");
  const out = picker({ countryCounts: { ...countryCounts, byValue: { ...countryCounts.byValue, USA: 1 } } });
  assert.match(out, /Estados Unidos <span/);
  assert.match(out, /USA <span class="meta">1<\/span>/);
});

/**
 * RosterPicker is a client component: rendered on the server, then hydrated. `Intl.DisplayNames` would run in Node and again in
 * the browser, two different ICU builds, and a region name they spell differently is a hydration mismatch. Labels therefore come
 * from the server inside CountryCounts.labels. (AudienceBlock also uses countryNameEs but is a SERVER component: leave it.)
 */
test("the picker never resolves a country label itself: no import of countryDisplay, no Intl.DisplayNames", () => {
  const src = readFileSync(join(process.cwd(), "src/app/(app)/sequences/_components/RosterPicker.tsx"), "utf8");
  assert.doesNotMatch(src, /countryDisplay|DisplayNames|countryLabel/);
  const server = readFileSync(join(process.cwd(), "src/lib/sequences/pageQueries.ts"), "utf8");
  assert.match(server, /countryLabelsEs\(/, "and the server does resolve them");
});
