/**
 * Unit tests for src/lib/companies/defaultPipelineStage.ts — the one-time
 * default `company.relationship_stage` backfill (owner-approved 2026-09-29,
 * see openspec/decisions/2026-09-30-decision-brief.md, "2. Default pipeline
 * stage — decided"). Pure planner — no DB. The 12-month window itself is
 * computed in SQL (defaultPipelineStageDb.ts, reusing
 * src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql) — this
 * module only ever sees the already-computed
 * `hasRecentQualifyingContact` boolean, so "replied inside 12 months" and
 * "replied outside 12 months" are modeled here as `true`/`false` on that
 * boolean, not by re-doing date arithmetic in JS (rule: one shared helper,
 * never a third definition of "effective last touch").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDefaultPipelineStage,
  planDefaultPipelineStages,
  type CompanyDefaultStageInput,
} from "@/lib/companies/defaultPipelineStage";

test("account_type = 'client' wins over a qualifying contact -> won", () => {
  const result = classifyDefaultPipelineStage({
    companyKey: "acme",
    accountType: "client",
    hasRecentQualifyingContact: true,
  });
  assert.equal(result, "won");
});

test("account_type = 'partner' -> qualified, even with no qualifying contact", () => {
  const result = classifyDefaultPipelineStage({
    companyKey: "acme",
    accountType: "partner",
    hasRecentQualifyingContact: false,
  });
  assert.equal(result, "qualified");
});

test("no account_type + a contact that replied within the last 12 months -> qualified", () => {
  const result = classifyDefaultPipelineStage({
    companyKey: "acme",
    accountType: null,
    hasRecentQualifyingContact: true,
  });
  assert.equal(result, "qualified");
});

test("no account_type + a contact that replied but NOT within the last 12 months -> prospect", () => {
  // The 12-month window already excluded this contact in SQL, so it never
  // sets hasRecentQualifyingContact — from this module's point of view it
  // is indistinguishable from "no qualifying contact at all", which is the
  // point: a stale reply must not qualify a company forever.
  const result = classifyDefaultPipelineStage({
    companyKey: "acme",
    accountType: null,
    hasRecentQualifyingContact: false,
  });
  assert.equal(result, "prospect");
});

test("no account_type + a contact with status 'meeting' within 12 months -> qualified", () => {
  const result = classifyDefaultPipelineStage({
    companyKey: "acme",
    accountType: null,
    hasRecentQualifyingContact: true,
  });
  assert.equal(result, "qualified");
});

test("no contacts at all -> prospect", () => {
  const result = classifyDefaultPipelineStage({
    companyKey: "acme",
    accountType: null,
    hasRecentQualifyingContact: false,
  });
  assert.equal(result, "prospect");
});

test("account_type = 'strategic_org' is not a special case: falls through to the contact rule", () => {
  assert.equal(
    classifyDefaultPipelineStage({
      companyKey: "acme",
      accountType: "strategic_org",
      hasRecentQualifyingContact: true,
    }),
    "qualified",
  );
  assert.equal(
    classifyDefaultPipelineStage({
      companyKey: "acme",
      accountType: "strategic_org",
      hasRecentQualifyingContact: false,
    }),
    "prospect",
  );
});

test("planDefaultPipelineStages groups company keys by resulting stage", () => {
  const candidates: CompanyDefaultStageInput[] = [
    { companyKey: "c1", accountType: "client", hasRecentQualifyingContact: false },
    { companyKey: "c2", accountType: "partner", hasRecentQualifyingContact: false },
    { companyKey: "c3", accountType: null, hasRecentQualifyingContact: true },
    { companyKey: "c4", accountType: null, hasRecentQualifyingContact: false },
  ];
  const plan = planDefaultPipelineStages(candidates);
  assert.deepEqual(plan.byStage, {
    won: ["c1"],
    qualified: ["c2", "c3"],
    prospect: ["c4"],
  });
});

test("planDefaultPipelineStages is a pure planner: calling it twice with the same input never mutates the input and returns an equal result both times", () => {
  const candidates: CompanyDefaultStageInput[] = Object.freeze([
    Object.freeze({ companyKey: "c1", accountType: "client", hasRecentQualifyingContact: false }),
    Object.freeze({ companyKey: "c2", accountType: null, hasRecentQualifyingContact: true }),
  ]) as unknown as CompanyDefaultStageInput[];

  const first = planDefaultPipelineStages(candidates);
  const second = planDefaultPipelineStages(candidates);

  assert.deepEqual(first, second);
  // Object.freeze above means any in-place mutation attempt would throw in
  // strict mode (this test file, and the module under test, are ESM =
  // always strict) — reaching this line at all is part of the proof.
  assert.equal(candidates.length, 2);
});
