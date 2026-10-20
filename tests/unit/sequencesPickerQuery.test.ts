import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DEFAULT_PICKER_QUERY, PICKER_PAGE_SIZE, type PickerQuery } from "@/lib/sequences/pickerFilters";
import { getCountries, getExampleNumber } from "libphonenumber-js";
import mobileExamples from "libphonenumber-js/examples.mobile.json" with { type: "json" };
import { resolveComplianceAudience } from "@/lib/sequences/complianceAudience";
import { PHONE_MIN_LENGTH, buildPickerPageQuery, buildPhoneLocatedPattern, countryFacts, floridaGeoPattern, normalizePhoneLikeSql, phoneLocatedPattern } from "@/lib/sequences/pickerQuery";
import { phoneCallingCodes } from "@/lib/sequences/phoneMarket";

const ME = "00000000-0000-4000-8000-000000000001";
const facts = { unmapped: ["atlantis"], us: ["united states"] };
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

test("countryFacts reads the audience: Spain, Japan and Canada are located (not unmapped); the US list is classifyMarket's alone", () => {
  const f = countryFacts(["Spain", "argentina", "canada", "United States", "  ", "spain", "Japan"]);
  assert.deepEqual(f.unmapped, []);
  assert.deepEqual(f.us, ["united states"], "Canada is a located country but not a US HIRING market");
});

test("the Florida pattern covers the phrases and the bare FL token, and nothing else", () => {
  const re = new RegExp(floridaGeoPattern().replace(/\\m/g, "\\b").replace(/\\M/g, "\\b"), "i");
  for (const hit of ["Miami", "Fort Lauderdale", "FL", "Florida, USA", "tampa"]) assert.ok(re.test(hit), hit);
  for (const miss of ["Flores", "Buenos Aires", "Texas", ""]) assert.ok(!re.test(miss), miss);
});

test("the phone link sits only in the no-country, postings-unresolved branch and costs no join or subquery", () => {
  const { text, params } = render({ showBlocked: true });
  const elseBranch = text.slice(text.indexOf(" else ("));
  assert.match(elseBranch, /else \(\(coalesce\(d\.posts_us, false\) or coalesce\(a\.posts_us, false\)\) = \(coalesce\(d\.posts_latam, false\) or coalesce\(a\.posts_latam, false\)\) and not \(regexp_replace\(translate\(coalesce\(p\.mobile_phone, ''\), [^)]*\), '\[\^0-9\+\]', '', 'g'\) ~ \$\d+ or regexp_replace\(translate\(coalesce\(p\.phone, ''\), [^)]*\), '\[\^0-9\+\]', '', 'g'\) ~ \$\d+\)\)/);
  const before = text.slice(0, text.indexOf(" else ("));
  assert.doesNotMatch(before, /translate\(coalesce\(p\.mobile_phone/, "a country that is present never reaches the phone");
  assert.ok(params.includes(phoneLocatedPattern()), "the dial-code pattern is a bound parameter");
  assert.doesNotMatch(text, /lateral/);
  assert.equal((text.match(/from person p/g) ?? []).length, 1, "no second pass over person for the phone");
});

test("the dial-code pattern is every country calling code, anchored on the plus, with the length floor", () => {
  const pattern = phoneLocatedPattern();
  assert.equal(pattern, buildPhoneLocatedPattern(phoneCallingCodes()));
  assert.ok(pattern.startsWith(`^\\+(?=[0-9]{${PHONE_MIN_LENGTH},})(`));
  for (const code of ["1", "34", "53", "54", "995"]) assert.match(pattern, new RegExp(`[(|]${code}[|)]`), code);
});

// The picker's SQL decides "blocked", the JS resolver decides the reason a row shows and the add itself. The one unsafe
// disagreement is SQL hiding a contact JS would allow, so for every phone JS resolves to a footer the SQL pattern must match.
const sqlSaysFooter = (phone: string) => new RegExp(phoneLocatedPattern()).test(normalizePhoneLikeSql(phone));
const digitsOf = (phone: string) => phone.replace(/\D/g, "");
/**
 * MEASURED, accepted: every located country is mailable now, so the length floor (PHONE_MIN_LENGTH, 8) is judged against
 * EVERY country's example number, not only the old footer markets'. Exactly two have a real 7-digit number: Tristan da
 * Cunha (+290 8999) and Tokelau (+690 7290), territories of about 250 and 1,500 people. The SQL hides a phone-only contact
 * there (no badge) while JS would mail it; lowering the floor to 7 would re-admit the `+5491` garbage it exists to keep out.
 * An OWNER decision, pinned so a third short country (or a floor change) fails here loudly instead of silently.
 */
const BELOW_THE_FLOOR = new Set(["TA", "TK"]);
const jsSaysFooter = (phone: string) => resolveComplianceAudience({ mobilePhone: phone, phone: null }) !== null;

test("the SQL phone test never blocks a number the JS resolver allows, across every country's example number", () => {
  let checked = 0;
  for (const iso of getCountries()) {
    const example = getExampleNumber(iso, mobileExamples)?.format("E.164");
    if (!example) continue;
    checked += 1;
    if (jsSaysFooter(example) && !BELOW_THE_FLOOR.has(iso)) assert.ok(sqlSaysFooter(example), `${iso} ${example}`);
  }
  assert.ok(checked > 200);
  for (const [phone, js, sql] of [
    ["+54 9 11 5555-1234", true, true],
    ["+54 (9) 11 5555 1234", true, true],
    ["+1 (809) 555-1234", true, true],
    ["+1 (305) 555-1234", true, true],
    ["+34 612 345 678", true, true],
    ["+995 555 123 456", true, true],
    ["+53 5 123 4567", false, true],
    ["5491155551234", false, false],
    ["", false, false],
  ] as const) {
    assert.equal(jsSaysFooter(phone), js, `js ${phone}`);
    assert.equal(sqlSaysFooter(phone), sql, `sql ${phone}`);
  }
});

test("the asymmetry is pinned and goes ONE way: SQL shows an embargoed phone that JS then holds, never the reverse", () => {
  // The decision: the sanctions list lives in complianceAudience.ts only. The SQL pre-filter does not encode it, so a Cuban,
  // Iranian, North Korean or Syrian phone appears in the default view badged `unmappedMarket` and the add guard refuses it.
  for (const phone of ["+53 5 123 4567", "+98 912 123 4567", "+850 191 234 5678", "+963 944 123 456"]) {
    assert.equal(jsSaysFooter(phone), false, `js holds ${phone}`);
    assert.equal(sqlSaysFooter(phone), true, `sql still shows ${phone}`);
  }
});

test("the length floor rejects implausibly short numbers and clips no real one", () => {
  for (const short of ["+5491", "+54", "+54 11 555", "+1 305", "+507 123"]) assert.equal(sqlSaysFooter(short), false, short);
  // The floor is a lower bound, never a validity check: it must sit at or below the shortest REAL number of a mapped country.
  // Paraguay is the shortest at 9 digits with the calling code (derivation: pickerQuery.ts); Panama, a 7-digit plan, is 10.
  const panama = "+507 200 1234";
  assert.equal(jsSaysFooter(panama), true, "fixture is a valid Panama landline");
  assert.equal(sqlSaysFooter(panama), true);
  assert.ok(PHONE_MIN_LENGTH <= digitsOf(panama).length);
  let shortestExample = Infinity;
  const clipped = new Set<string>();
  for (const iso of getCountries()) {
    const example = getExampleNumber(iso, mobileExamples)?.format("E.164");
    if (!example || !jsSaysFooter(example)) continue;
    if (!sqlSaysFooter(example)) { clipped.add(iso); continue; }
    shortestExample = Math.min(shortestExample, digitsOf(example).length);
  }
  assert.deepEqual([...clipped].sort(), [...BELOW_THE_FLOOR].sort(), "the countries the floor clips are exactly the two measured and accepted");
  assert.ok(PHONE_MIN_LENGTH <= shortestExample, `floor ${PHONE_MIN_LENGTH} vs shortest example ${shortestExample}`);
  assert.equal(sqlSaysFooter("+5491155551234 ext 123456"), true, "an extension only lengthens a number: there is no upper bound");
});

test("an empty prefix list yields a pattern that matches nothing, not every number with a plus", () => {
  const re = new RegExp(buildPhoneLocatedPattern([]));
  for (const phone of ["+5491155551234", "+13055551234", "+", "+++++++++++", ""]) assert.equal(re.test(phone), false, phone);
});

test("the floor counts digits only: plus signs cannot pad a short number past it", () => {
  for (const padded of ["+54+++++", "+54++++++++", "+1+++++++"]) assert.equal(sqlSaysFooter(padded), false, padded);
});

test("the unit model of the SQL folds the digit scripts libphonenumber reads, so a fold regression fails here", () => {
  for (const phone of ["+１ 305 555 1234", "+١ 305 555 1234", "+۱ 305 555 1234"]) {
    assert.equal(jsSaysFooter(phone), true, `js ${phone}`);
    assert.equal(sqlSaysFooter(phone), true, `sql ${phone}`);
  }
  assert.equal(normalizePhoneLikeSql("＋１ 305"), "1305", "the fullwidth plus is not a plus to libphonenumber either, so it is stripped");
});
