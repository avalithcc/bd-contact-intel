/**
 * `/companies` LinkedIn presence filter (any / with / without) — built like
 * the client-status filter and proven to compose with the other filters.
 * Db-free: conditions are rendered through PgDialect.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { linkedinPresenceCondition } from "@/lib/companies/linkedinFilter";
import { isLinkedinPresence } from "@/lib/companies/linkedinPresence";
import { companyListConditions, type CompanyListFilters } from "@/lib/companies/listConditions";

const ME = "11111111-1111-1111-1111-111111111111";
const NO_FILTERS: CompanyListFilters = { view: "all", meBdId: ME };

function render(conditions: ReturnType<typeof companyListConditions>) {
  return new PgDialect().sqlToQuery(and(...conditions)!);
}

test("isLinkedinPresence: only the two real states; absent or unknown is not a filter", () => {
  assert.equal(isLinkedinPresence("with"), true);
  assert.equal(isLinkedinPresence("without"), true);
  for (const v of [undefined, "", "any", "WITH", "true", "null"]) assert.equal(isLinkedinPresence(v), false, String(v));
});

test("linkedinPresenceCondition: with -> IS NOT NULL, no params", () => {
  const q = render([linkedinPresenceCondition("with")!]);
  assert.match(q.sql, /"linkedin_url" is not null/i);
  assert.deepEqual(q.params, []);
});

test("linkedinPresenceCondition: without -> IS NULL, no params", () => {
  const q = render([linkedinPresenceCondition("without")!]);
  assert.match(q.sql, /"linkedin_url" is null/i);
  assert.deepEqual(q.params, []);
});

test("linkedinPresenceCondition: any (undefined) adds no condition", () => {
  assert.equal(linkedinPresenceCondition(undefined), undefined);
});

test("companyListConditions: linkedin alone is usable with nothing else set", () => {
  const q = render(companyListConditions({ ...NO_FILTERS, linkedin: "without" }));
  assert.match(q.sql, /"linkedin_url" is null/i);
  assert.doesNotMatch(q.sql, /account_type|relationship_stage|client_status/);
});

test("companyListConditions: composes with stage + account type + client status", () => {
  const q = render(
    companyListConditions({ ...NO_FILTERS, stage: "won", accountType: "client", clientStatus: "inactive", linkedin: "without" }),
  );
  assert.match(q.sql, /"relationship_stage" = \$1/);
  assert.match(q.sql, /"account_type" = \$2/);
  assert.match(q.sql, /"client_status" = \$3/);
  assert.match(q.sql, /"linkedin_url" is null/i);
  assert.deepEqual(q.params, ["won", "client", "inactive"]);
});

test("companyListConditions: composes with the text search (name search narrowed to missing LinkedIn)", () => {
  const q = render(companyListConditions({ ...NO_FILTERS, linkedin: "without", q: "acme" }));
  assert.match(q.sql, /"linkedin_url" is null/i);
  assert.match(q.sql, /"display_name" ilike/i);
});

test("companyListConditions: unknown linkedin value in the type's absence changes nothing", () => {
  assert.deepEqual(companyListConditions({ ...NO_FILTERS, linkedin: undefined }), []);
});

test("companyListConditions: does not mutate its input and is repeatable", () => {
  const filters: CompanyListFilters = { ...NO_FILTERS, stage: "won", linkedin: "with" };
  const snapshot = structuredClone(filters);
  const a = render(companyListConditions(filters));
  const b = render(companyListConditions(filters));
  assert.deepEqual(filters, snapshot);
  assert.deepEqual(a, b);
});
