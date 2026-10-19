/**
 * Owner definition (2026-10-19): a "current client" is a company with relationship_stage = 'won' AND
 * client_status = 'active'. People of such companies are out of the reply-rate cohort (numerator and denominator).
 * Everyone else counts: prospects, won + inactive, won with no client_status, any other stage.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { isCurrentClient } from "@/lib/companies/clientStatus";
import { notCurrentClientPersonSql } from "@/lib/reports/currentClient";
import { buildCohortDrilldownQuery, buildReportAggregatesQuery } from "@/lib/reports/queries";

const dialect = new PgDialect();
const PARAMS = { fromIso: "2026-10-01T03:00:00.000Z", toIso: "2026-10-19T14:00:00.000Z", bdId: null };

test("isCurrentClient: only won + active is a current client", () => {
  assert.equal(isCurrentClient({ relationshipStage: "won", clientStatus: "active" }), true);
  assert.equal(isCurrentClient({ relationshipStage: "won", clientStatus: "inactive" }), false);
  assert.equal(isCurrentClient({ relationshipStage: "won", clientStatus: null }), false);
  assert.equal(isCurrentClient({ relationshipStage: "qualified", clientStatus: "active" }), false);
  assert.equal(isCurrentClient({ relationshipStage: null, clientStatus: "active" }), false);
  assert.equal(isCurrentClient({ relationshipStage: "prospect", clientStatus: null }), false);
});

test("isCurrentClient does not mutate its input", () => {
  const input = { relationshipStage: "won", clientStatus: "active" };
  const before = { ...input };
  isCurrentClient(input);
  isCurrentClient(input);
  assert.deepEqual(input, before);
});

test("notCurrentClientPersonSql: canonicalizes the person's company_key through company_alias and checks won + active", () => {
  const { sql } = dialect.sqlToQuery(notCurrentClientPersonSql());
  assert.match(sql, /not exists/i);
  assert.match(sql, /relationship_stage = 'won'/i);
  assert.match(sql, /client_status = 'active'/i);
  assert.match(sql, /company_alias/i);
  assert.match(sql, /person\.company_key/i);
  assert.equal(sql, dialect.sqlToQuery(notCurrentClientPersonSql()).sql, "same text every call");
});

test("the funnel cohort and the cohort drill-down apply the SAME exclusion (a tile and its list cannot disagree)", () => {
  const fragment = dialect.sqlToQuery(notCurrentClientPersonSql()).sql;
  const agg = dialect.sqlToQuery(buildReportAggregatesQuery(PARAMS)).sql;
  const drill = dialect.sqlToQuery(buildCohortDrilldownQuery({ ...PARAMS, population: "replied" })).sql;
  assert.ok(agg.includes(fragment), "rpt_person_scope");
  assert.ok(drill.includes(fragment), "rpt_cohort");
});
