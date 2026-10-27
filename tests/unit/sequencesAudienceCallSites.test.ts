/**
 * The audience is recomputed at view, draft, approval, release and unsubscribe time and never stored, so every reader must hand
 * the resolver the SAME facts, roster included. Three layers: the resolver's input type REQUIRES the roster (tsc lists a caller
 * that skips it), the row mapper THROWS when a read forgot the column, and this scan fails when a new caller appears that does
 * not go through them.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { AUDIENCE_FACT_COLUMNS, audienceInputsFromRow } from "@/lib/sequences/audienceInputs";
import { audienceFactsSql, rosterCountriesSql } from "@/lib/sequences/rosterQuery";

const row = { person_country: null, mobile_phone: null, phone: null, company_country: "United States", posting_markets: ["us"], roster_countries: [{ country: "Argentina", n: "3" }] };

test("the mapper reads the roster of a real row, counts as numbers", () => {
  assert.deepEqual(audienceInputsFromRow(row).rosterCountries, [{ country: "Argentina", n: 3 }]);
  assert.equal(audienceInputsFromRow({ ...row, roster_countries: null }).rosterCountries.length, 0);
});

test("a read that forgot a fact fails loudly instead of resolving without it", () => {
  for (const column of AUDIENCE_FACT_COLUMNS) {
    const { [column]: _dropped, ...without } = row as Record<string, unknown>;
    assert.throws(() => audienceInputsFromRow(without), new RegExp(column), column);
  }
});

test("the shared select produces every column the mapper reads (the producer, not a hand-built row)", () => {
  const { sql: text } = new PgDialect().sqlToQuery(audienceFactsSql);
  for (const column of AUDIENCE_FACT_COLUMNS) assert.match(text, new RegExp(`(as |p\\.)${column}\\b`), column);
});

test("the roster read pools the canonical company, skips merged contacts and blank countries, and groups in one statement", () => {
  const { sql: text } = new PgDialect().sqlToQuery(rosterCountriesSql);
  assert.match(text, /q\.merged_into_id is null/);
  assert.match(text, /btrim\(coalesce\(q\.country, ''\)\) <> ''/);
  assert.match(text, /company_alias/);
  assert.match(text, /group by 1/);
  assert.match(text, /^coalesce\(\(\s*case when btrim\(coalesce\(p\.country, ''\)\) = ''/, "the roster is read only for a person with no country of their own: the resolver never consults it otherwise");
  assert.doesNotMatch(text, /limit \d/i, "a grouped read per distinct filed text: bounded by the distinct countries, never by a row cap that could drop a colleague");
});

const SRC = path.resolve(__dirname, "../../src");
const CALL = /\b(resolveComplianceAudience|explainComplianceAudience|unsubscribePageAudience|buildMemberAudience)\(/;
/** The definitions themselves and the pure shapers, which receive inputs and read no database. */
const PURE = new Set(["lib/sequences/complianceAudience.ts", "lib/sequences/unsubscribePageAudience.ts", "lib/sequences/audienceView.ts"]);
/** Every file under src/ that asks for an audience, found by scan. A new caller must be added here ON PURPOSE. */
const DB_CALLERS = [
  "lib/sequences/approvalQueries.ts",
  "lib/sequences/detailQueries.ts",
  "lib/sequences/draftQueries.ts",
  "lib/sequences/pageQueries.ts",
  "lib/sequences/releaseQueries.ts",
  "lib/sequences/rosterQueries.ts",
  "lib/sequences/seedQueries.ts",
  "lib/sequences/unsubscribeQueries.ts",
];
/** Asks the resolver about a person-country-only question; no company, so an empty roster is the truth, spelled out. */
const COUNTRY_ONLY = ["lib/sequences/pickerQuery.ts"];

const callers = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => f.split(path.sep).join("/"))
  .filter((f) => !PURE.has(f) && CALL.test(readFileSync(path.join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));

test("the callers of the audience are exactly the known ones", () => {
  assert.deepEqual([...callers].sort(), [...DB_CALLERS, ...COUNTRY_ONLY].sort());
});

test("every database reader selects the roster and maps rows through the shared mapper", () => {
  for (const f of DB_CALLERS) {
    const code = readFileSync(path.join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.match(code, /audienceInputsFromRow\(/, `${f} must map its row with audienceInputsFromRow`);
    assert.match(code, /audienceFactsSql|rosterCountriesSql|pk_roster|roster_countries/, `${f} must select the roster`);
    assert.doesNotMatch(code, /personCountry\s*:\s*r\./, `${f} spells the audience inputs by hand; use audienceInputsFromRow`);
  }
});

test("the country-only caller says so with an explicit empty roster", () => {
  for (const f of COUNTRY_ONLY) assert.match(readFileSync(path.join(SRC, f), "utf8"), /rosterCountries:\s*\[\]/, f);
});
