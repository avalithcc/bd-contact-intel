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
import { pickerView, type PickerContact } from "@/lib/sequences/pickerView";
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
  assert.match(q.sql, /unaccent\(concat_ws\(' ', p\.first_name, p\.last_name, p\.company\)\) ilike \(select unaccent\(\$1\)\)/);
  assert.equal(q.params[0], "%50\\%\\_José%");
});

const contact = (over: Partial<PickerContact>): PickerContact =>
  ({ personId: "p", name: "X", company: null, email: null, florida: false, block: null, ...over }) as PickerContact;

test("roster picker's in-memory search finds José, Peña and Pérez by their unaccented spelling and the reverse", () => {
  const contacts = [contact({ personId: "1", name: "José Peña" }), contact({ personId: "2", name: "Ana", company: "Pérez SA" })];
  const ids = (search: string) =>
    pickerView(contacts, new Map(), { search, florida: false, showBlocked: true }).rows.map((r) => r.contact.personId);
  assert.deepEqual(ids("jose"), ["1"]);
  assert.deepEqual(ids("PENA"), ["1"]);
  assert.deepEqual(ids("perez"), ["2"]);
  assert.deepEqual(ids("Pérez"), ["2"]);
});

test("the Empresa filter's JS twin folds accents too", () => {
  assert.equal(companyNameMatchesTerm("José SA", null, "jose"), true);
  assert.equal(companyNameMatchesTerm(null, "Peñarol", "PENAROL"), true);
  assert.equal(companyNameMatchesTerm("Acme", "Peñarol", "penarol"), false); // free text wins the display
});
