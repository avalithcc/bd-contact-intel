/**
 * Every search surface that can be rendered without a database must fold accents. A new search site written without
 * the shared helper (src/lib/search/accentInsensitive.ts) shows up here as a plain `ilike`. The surfaces that need a
 * live connection are covered in tests/db/accentInsensitiveSearch.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { company } from "@/db/schema";
import { companySearchCondition } from "@/lib/companies/searchCondition";
import { companyNameMatchesTerm } from "@/lib/contacts/companyDisplayName";
import { DEFAULT_PICKER_QUERY } from "@/lib/sequences/pickerFilters";
import { buildPickerPageQuery } from "@/lib/sequences/pickerQuery";
import { buildRosterCandidatesQuery } from "@/lib/sequences/rosterQuery";

const dialect = new PgDialect();
const flat = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => dialect.sqlToQuery(q);

test("/companies search folds accents on display_name, domain, alias_key and the LinkedIn slug", () => {
  const { sql: text } = flat(sql`select 1 from ${company} where ${companySearchCondition("jose")}`);
  assert.equal(text.match(/unaccent\(/g)?.length, 8); // 4 columns, each folded on both sides
  assert.doesNotMatch(text, /\bilike \$/i);
});

test("Sequences roster picker folds accents on the name and escapes the user's wildcards", () => {
  const q = flat(buildRosterCandidatesQuery({ limit: 10, search: "50%_José" }));
  assert.match(q.sql, /unaccent\(concat_ws\(' ', p\.first_name, p\.last_name\)\) ilike \(select unaccent\(\$1\)\)/);
  // The company half (companyNameMatchCondition) folds both the free text and the canonical name, with the same escaped term.
  assert.match(q.sql, /unaccent\(p\.company\) ilike \(select unaccent\(\$2\)\)/);
  assert.match(q.sql, /unaccent\("company"\."display_name"\) ilike \(select unaccent\(\$3\)\)/);
  assert.equal(q.params[0], "%50\\%\\_José%");
  assert.equal(q.params[1], "%50\\%\\_José%");
  assert.equal(q.params[2], "%50\\%\\_José%");
});

test("the roster picker's page query folds accents over name, company, email and title with the user's wildcards escaped", () => {
  const q = flat(buildPickerPageQuery({ ...DEFAULT_PICKER_QUERY, search: "50%_José" }, "00000000-0000-4000-8000-000000000001", { unmapped: [], us: [] }));
  assert.match(q.sql, /unaccent\(concat_ws\(' ', p\.first_name, p\.last_name, .*p\.email, p\.job_title\)\) ilike \(select unaccent\(\$\d+\)\)/);
  assert.ok(q.params.includes("%50\\%\\_José%"));
});

test("the Empresa filter's JS twin folds accents too", () => {
  assert.equal(companyNameMatchesTerm("José SA", null, "jose"), true);
  assert.equal(companyNameMatchesTerm(null, "Peñarol", "PENAROL"), true);
  assert.equal(companyNameMatchesTerm("Acme", "Peñarol", "penarol"), false); // free text wins the display
});
