/**
 * Unit tests for src/lib/companies/linkedinBulkLoad.ts. Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LINKEDIN_BULK_LOAD_PAIRS,
  planLinkedinBulkLoad,
  type LinkedinBulkLoadMatch,
} from "@/lib/companies/linkedinBulkLoad";

const pairs = [
  { displayName: "Alpha", slug: "alpha-co" },
  { displayName: "Beta", slug: "beta" },
  { displayName: "Gamma", slug: "gamma" },
  { displayName: "Delta", slug: "delta" },
  { displayName: "Eps", slug: "in/not-a-company" },
];

function matches(): Map<string, LinkedinBulkLoadMatch[]> {
  return new Map([
    ["Alpha", [{ companyKey: "alpha", linkedinUrl: null }]],
    ["Beta", [{ companyKey: "beta", linkedinUrl: "linkedin.com/company/old" }]],
    ["Gamma", [{ companyKey: "g1", linkedinUrl: null }, { companyKey: "g2", linkedinUrl: null }]],
    ["Eps", [{ companyKey: "eps", linkedinUrl: null }]],
  ]);
}

test("planLinkedinBulkLoad writes only unique, empty, valid matches and reports every skip", () => {
  const plan = planLinkedinBulkLoad(pairs, matches());
  assert.deepEqual(plan.writes, [
    { companyKey: "alpha", displayName: "Alpha", linkedinUrl: "linkedin.com/company/alpha-co" },
  ]);
  const reasons = Object.fromEntries(plan.skips.map((s) => [s.displayName, s.reason]));
  assert.deepEqual(reasons, {
    Beta: "already_has_linkedin",
    Gamma: "multiple_matches",
    Delta: "no_match",
    Eps: "rejected_by_normaliser",
  });
});

test("planLinkedinBulkLoad does not mutate its inputs and is repeatable", () => {
  const input = matches();
  const snapshot = JSON.stringify([...input]);
  const pairsSnapshot = JSON.stringify(pairs);
  const first = planLinkedinBulkLoad(pairs, input);
  const second = planLinkedinBulkLoad(pairs, input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify([...input]), snapshot);
  assert.equal(JSON.stringify(pairs), pairsSnapshot);
});

test("the shipped list has 50 unique names, and every slug normalises to a company page", () => {
  assert.equal(LINKEDIN_BULK_LOAD_PAIRS.length, 50);
  assert.equal(new Set(LINKEDIN_BULK_LOAD_PAIRS.map((p) => p.displayName)).size, 50);
  const plan = planLinkedinBulkLoad(
    LINKEDIN_BULK_LOAD_PAIRS,
    new Map(LINKEDIN_BULK_LOAD_PAIRS.map((p) => [p.displayName, [{ companyKey: p.displayName, linkedinUrl: null }]])),
  );
  assert.equal(plan.skips.length, 0);
  assert.equal(plan.writes.length, 50);
  const byName = new Map(plan.writes.map((w) => [w.displayName, w.linkedinUrl]));
  assert.equal(byName.get("Calm es simple."), "linkedin.com/company/30576424");
  assert.equal(byName.get("Valkimia/"), "linkedin.com/company/valkimia");
  assert.equal(byName.get("Workia | HR Tech"), "linkedin.com/company/workia");
  assert.equal(byName.get("Applicant - IT Talent Management"), "linkedin.com/company/applicant---it-talent-management");
  assert.equal(byName.get("Ualá"), "linkedin.com/company/ual-");
});
