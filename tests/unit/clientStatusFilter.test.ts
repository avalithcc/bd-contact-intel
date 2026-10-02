/**
 * Unit tests for the `/companies` client-status filter: the WHERE condition
 * builder (clientStatusFilter.ts) and the pure assembly of every list filter
 * (listConditions.ts) — the latter is what proves the new filter COMPOSES
 * with stage and account type instead of replacing them. Both modules are
 * db-free so they run without a live `DATABASE_URL`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { company } from "@/db/schema";
import { clientStatusCondition } from "@/lib/companies/clientStatusFilter";
import { companyListConditions, type CompanyListFilters } from "@/lib/companies/listConditions";

const ME = "11111111-1111-1111-1111-111111111111";
const NO_FILTERS: CompanyListFilters = { view: "all", meBdId: ME };

function render(conditions: ReturnType<typeof companyListConditions>) {
  return new PgDialect().sqlToQuery(and(...conditions)!);
}

test("clientStatusCondition: equality for each value", () => {
  assert.deepEqual(clientStatusCondition("active"), eq(company.clientStatus, "active"));
  assert.deepEqual(clientStatusCondition("inactive"), eq(company.clientStatus, "inactive"));
});

test("clientStatusCondition: undefined when no filter is set", () => {
  assert.equal(clientStatusCondition(undefined), undefined);
});

test("companyListConditions: no filters yields no conditions", () => {
  assert.deepEqual(companyListConditions(NO_FILTERS), []);
});

test("companyListConditions: client status alone is usable with no stage or account type", () => {
  const q = render(companyListConditions({ ...NO_FILTERS, clientStatus: "inactive" }));
  assert.match(q.sql, /"client_status" = \$1/);
  assert.doesNotMatch(q.sql, /account_type|relationship_stage/);
  assert.deepEqual(q.params, ["inactive"]);
});

test("companyListConditions: composes with account type", () => {
  const q = render(companyListConditions({ ...NO_FILTERS, accountType: "client", clientStatus: "inactive" }));
  assert.match(q.sql, /"account_type" = \$1/);
  assert.match(q.sql, /"client_status" = \$2/);
  assert.deepEqual(q.params, ["client", "inactive"]);
});

test("companyListConditions: composes with stage (won + inactive)", () => {
  const q = render(companyListConditions({ ...NO_FILTERS, stage: "won", clientStatus: "inactive" }));
  assert.match(q.sql, /"relationship_stage" = \$1/);
  assert.match(q.sql, /"client_status" = \$2/);
  assert.deepEqual(q.params, ["won", "inactive"]);
});

test("companyListConditions: stage + account type + client status + owner view all apply together", () => {
  const q = render(
    companyListConditions({ view: "mine", meBdId: ME, stage: "won", accountType: "client", clientStatus: "active" }),
  );
  assert.deepEqual(q.params, ["won", ME, "client", "active"]);
});

test("companyListConditions: does not mutate its input and is repeatable", () => {
  const filters: CompanyListFilters = { ...NO_FILTERS, stage: "won", clientStatus: "active" };
  const snapshot = structuredClone(filters);
  const a = render(companyListConditions(filters));
  const b = render(companyListConditions(filters));
  assert.deepEqual(filters, snapshot);
  assert.deepEqual(a, b);
});
