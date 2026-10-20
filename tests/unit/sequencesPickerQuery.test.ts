import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DEFAULT_PICKER_QUERY, PICKER_PAGE_SIZE, type PickerQuery } from "@/lib/sequences/pickerFilters";
import { buildPickerPageQuery, countryFacts, floridaGeoPattern } from "@/lib/sequences/pickerQuery";

const ME = "00000000-0000-4000-8000-000000000001";
const facts = { unmapped: ["spain"], us: ["united states"] };
const render = (over: Partial<PickerQuery> = {}) => {
  const q = new PgDialect().sqlToQuery(buildPickerPageQuery({ ...DEFAULT_PICKER_QUERY, ...over }, ME, facts));
  return { text: q.sql.replace(/\s+/g, " "), params: q.params };
};

test("the default query lists every live contact with an email: no hiring, Florida or owner restriction", () => {
  const { text, params } = render();
  assert.match(text, /p\.merged_into_id is null/);
  assert.match(text, /btrim\(coalesce\(p\.email, ''\)\) <> ''/);
  assert.doesNotMatch(text, /p\.owner_bd_id/);
  const where = text.slice(text.indexOf(" where p.merged_into_id"), text.indexOf(" order by"));
  assert.doesNotMatch(where, /hire|florida|~\*/, "no hiring or Florida gate in the WHERE");
  assert.equal((text.match(/from job_posting jp/g) ?? []).length, 1, "one set-based pass over the postings, never a subquery per person");
  assert.doesNotMatch(text, /company_key in \(select ca\.company_key/, "the per-person alias OR form made Postgres Seq Scan the whole company table for every person");
  assert.ok(!params.includes(ME));
});

test("a page is bounded: one extra row proves there is more, and the offset is a bound parameter", () => {
  const { text, params } = render({ offset: 100 });
  assert.match(text, /offset \$\d+ limit \$\d+/);
  assert.ok(params.includes(100));
  assert.ok(params.includes(PICKER_PAGE_SIZE + 1));
});

test("each filter adds exactly its own predicate", () => {
  assert.match(render({ hiring: true }).text, /where p\.merged_into_id is null and .*\(coalesce\(d\.hire, 0\) \+ coalesce\(a\.hire, 0\)\) > 0/);
  assert.match(render({ florida: true }).text, /where .*coalesce\(d\.florida, false\).*concat_ws\(' ', p\.city, p\.region\) ~\* \$\d+/);
  assert.match(render().text, /filter \(where \(jp\.closed_at is null and least\(jp\.posted_at, jp\.first_seen\) >= now\(\) - interval '30 days'\) and jp\.market = 'us'\)/, "freshness comes from the shared openPosting rule");
  const mine = render({ mine: true });
  assert.match(mine.text, /p\.owner_bd_id = \$\d+::uuid/);
  assert.ok(mine.params.includes(ME));
});

test("the search folds accents per token across name, displayed company, email and job title, and escapes wildcards", () => {
  const { text, params } = render({ search: "50%_José pena" });
  const haystack = /unaccent\(concat_ws\(' ', p\.first_name, p\.last_name, coalesce\(nullif\(p\.company, ''\), cn\.display_name\), p\.email, p\.job_title\)\) ilike \(select unaccent\(\$\d+\)\)/g;
  assert.equal(text.match(haystack)?.length, 2, "one folded haystack test per token");
  assert.ok(params.includes("%50\\%\\_José%"));
  assert.ok(params.includes("%pena%"));
});

test("blocked contacts are ordered last when shown and filtered out when hidden, by the same expression", () => {
  const hidden = render({ showBlocked: false }).text;
  const shown = render({ showBlocked: true }).text;
  assert.match(hidden, /and not coalesce\(\(/);
  assert.doesNotMatch(shown, /and not coalesce\(\(/);
  assert.match(shown, /order by coalesce\(\(/);
  for (const t of [hidden, shown]) {
    assert.match(t, /email_suppression/);
    assert.match(t, /coalesce\(cn\.client_status, cca\.client_status\) is not null/);
    assert.match(t, /= any\(array\[\$\d+\]::text\[\]\)/);
  }
});

test("the unmapped-country list is a bound array, and an empty one is still valid SQL", () => {
  const empty = new PgDialect().sqlToQuery(buildPickerPageQuery(DEFAULT_PICKER_QUERY, ME, { unmapped: [], us: [] })).sql;
  assert.match(empty, /array\[\]::text\[\]/);
});

test("countryFacts uses recipientMarket: only countries without a postal address are unmapped, Canada rides with the US", () => {
  const f = countryFacts(["Spain", "argentina", "canada", "United States", "  ", "spain", "Japan"]);
  assert.deepEqual(f.unmapped.sort(), ["japan", "spain"]);
  assert.deepEqual(f.us, ["united states"]);
});

test("the Florida pattern covers the phrases and the bare FL token, and nothing else", () => {
  const re = new RegExp(floridaGeoPattern().replace(/\\m/g, "\\b").replace(/\\M/g, "\\b"), "i");
  for (const hit of ["Miami", "Fort Lauderdale", "FL", "Florida, USA", "tampa"]) assert.ok(re.test(hit), hit);
  for (const miss of ["Flores", "Buenos Aires", "Texas", ""]) assert.ok(!re.test(miss), miss);
});
