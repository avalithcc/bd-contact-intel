/**
 * The new-contact dialog's company autocomplete: the pure rules (query normalisation, which existing keys a typed
 * name should be checked against, what counts as a near match) and the ONE statement behind the search. Db-free:
 * the statement renders through PgDialect, so nothing here needs DATABASE_URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  PICKER_MAX,
  findNearMatch,
  possibleDuplicateKeys,
  normalizePickerQuery,
  probeKeys,
  type PickerCompany,
} from "@/lib/companies/companyPicker";
import { buildCompanyPickerQuery } from "@/lib/companies/companyPickerQuery";
import { buildNewContactFields } from "@/lib/contacts/createContact";

const co = (key: string, contacts: number, name = key): PickerCompany => ({ key, displayName: name, domain: null, contacts });
const render = (q: string) => new PgDialect().sqlToQuery(buildCompanyPickerQuery(q));

test("a query shorter than two characters is the empty query (top companies), longer ones are trimmed and collapsed", () => {
  assert.equal(normalizePickerQuery(undefined), "");
  assert.equal(normalizePickerQuery("a"), "");
  assert.equal(normalizePickerQuery("  An   dina  "), "An dina");
  assert.equal(normalizePickerQuery("x".repeat(500)).length, 80);
});

// The trap this pins: searchCompanyPicker decides between the cache and a live read, and the query
// builder decides between the top-companies statement and a search. If those two disagree about what
// counts as "empty", a one-character query misses the cache and runs the 862 ms group-over-every-person
// statement -- which a signed-in BD can call in a loop, on a pool whose real ceiling is 35. Shipped
// that way once: the cache tested `rawQuery.trim()` while the builder used normalizePickerQuery.
test("anti-drift: whatever normalizePickerQuery calls empty must compile to the TOP-companies statement", () => {
  const topSql = render("").sql;
  for (const raw of ["", "   ", "a", " a ", "Z"]) {
    assert.equal(normalizePickerQuery(raw), "", `normalizePickerQuery(${JSON.stringify(raw)})`);
    assert.equal(render(raw).sql, topSql, `render(${JSON.stringify(raw)}) must be the top-companies statement`);
  }
  // And a real query must NOT be: otherwise the cache would serve a search.
  assert.notEqual(render("an").sql, topSql);
});

test("probeKeys: every leading-token prefix of the typed key plus its compact form, deduplicated", () => {
  assert.deepEqual(probeKeys("Andina Tech"), ["andina", "andina tech", "andinatech"]);
  assert.deepEqual(probeKeys("Nubank"), ["nubank"]);
  assert.deepEqual(probeKeys("S.A."), []);
});

test("near match: the mockup case, typing 'Andina Tech' while 'Andina' exists", () => {
  const hit = findNearMatch("Andina Tech", [co("andina tech", 1), co("andina", 23)]);
  assert.equal(hit?.key, "andina");
});

test("near match: the existing company is the longer name", () => {
  assert.equal(findNearMatch("Andina", [co("andina tech", 1)])?.key, "andina tech");
});

test("near match: spacing and one-letter typos on names long enough to mean something", () => {
  assert.equal(findNearMatch("Nu Bank", [co("nubank", 11)])?.key, "nubank");
  assert.equal(findNearMatch("Tecpetrl", [co("tecpetrol", 8)])?.key, "tecpetrol");
});

test("near match: the most populated candidate wins, it is the real one", () => {
  assert.equal(findNearMatch("Andina Tech", [co("andina", 2), co("andina tech sa x", 40)])?.key, "andina tech sa x");
});

test("typing the real company next to its smaller twin does not nag; typing the twin does", () => {
  assert.equal(findNearMatch("Andina S.A.", [co("andina", 23), co("andina tech", 1)]), null);
  assert.equal(findNearMatch("Andina Tech", [co("andina", 23), co("andina tech", 1)])?.key, "andina");
});

test("possible duplicate badge: only the smaller twin of a listed company", () => {
  const list = [co("andina", 23), co("andina tech", 1), co("nubank", 11)];
  assert.deepEqual([...possibleDuplicateKeys(list)], ["andina tech"]);
  assert.equal(possibleDuplicateKeys([co("andina", 3), co("andina tech", 3)]).size, 0);
});

test("no noise: short names, shared first letters, unrelated and two-letter-typo names do not fire", () => {
  assert.equal(findNearMatch("AB", [co("abc", 5)]), null);
  assert.equal(findNearMatch("Globant", [co("globex", 5), co("global", 9)]), null);
  assert.equal(findNearMatch("Banco Galicia", [co("banco", 3)])?.key, "banco"); // whole-token prefix: this one DOES fire
  assert.equal(findNearMatch("Bancor", [co("banco", 3)]), null); // a prefix of a token is not a token prefix
  assert.equal(findNearMatch("Naranja", [co("nube", 3)]), null);
  assert.equal(findNearMatch("", [co("andina", 3)]), null);
});

test("the search is one statement with a LIMIT, bounded by PICKER_MAX", () => {
  const { sql: raw, params } = render("andi");
  const sql = raw.trim();
  assert.equal(sql.split(";").filter((s) => s.trim()).length, 1);
  assert.match(sql, /^with pg_page as \(/);
  assert.match(sql, /limit \$\d+\)/);
  assert.ok(params.includes(PICKER_MAX));
});

test("the contact count is alias-aware (companyContactsCondition) and runs per RETURNED row, outside the page CTE", () => {
  const { sql } = render("andi");
  const [cte, final] = sql.split(/\)\s*select pg_key as company_key/);
  assert.ok(final, "the final select must follow the page CTE");
  assert.match(final, /"person"\."merged_into_id" is null/);
  assert.match(final, /"person"\."company_key" in \(select pg_key::text union select "company_alias"\."alias_key"/);
  assert.doesNotMatch(cte, /from "person"/);
  assert.doesNotMatch(final, /x\.company_key = pg_key/);
});

test("the typed text reaches the statement as bind parameters, never inline", () => {
  const { sql, params } = render("o'brien; drop table company");
  assert.doesNotMatch(sql, /drop table/);
  assert.ok(params.some((p) => typeof p === "string" && p.includes("drop table")));
});

test("the empty query ranks by contacts in one statement, alias-aware count unchanged", () => {
  const { sql, params } = render("");
  assert.match(sql, /group by "person"\."company_key"|group by company_key/);
  assert.match(sql, /"person"\."company_key" in \(select pg_key::text union select/);
  assert.ok(params.includes(PICKER_MAX));
});

test("picking an existing company stores ITS key, not one re-derived from the display text", () => {
  const picked = buildNewContactFields({
    firstName: "R", lastName: "G", linkedinUrl: "", email: "", company: "Banco Galicia S.A.", companyKey: "banco galicia sa legacy",
  });
  assert.equal(picked.companyKey, "banco galicia sa legacy");
  assert.equal(picked.company, "Banco Galicia S.A.");
});

test("free text still derives the key, and an empty company never carries a key", () => {
  const typed = buildNewContactFields({ firstName: "R", lastName: "G", linkedinUrl: "", email: "", company: "Andina Tech" });
  assert.equal(typed.companyKey, "andina tech");
  const none = buildNewContactFields({ firstName: "R", lastName: "G", linkedinUrl: "", email: "", company: " ", companyKey: "andina" });
  assert.equal(none.companyKey, null);
  assert.equal(none.company, null);
});
