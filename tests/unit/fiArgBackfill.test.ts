import assert from "node:assert/strict";
import { test } from "node:test";
import { FI_ARG_SOURCE_KEY, planFiArgBackfill, type FiArgRow } from "@/lib/fiArgBackfill/plan";

// Synthetic rows shaped like the lead -> person_id_map -> person join.
const row = (leadId: string, over: Partial<FiArgRow> = {}): FiArgRow => ({
  leadId,
  personId: `p-${leadId}`,
  inScope: true,
  source: { companyDisplay: null, companyRaw: "Acme Raw", city: "Buenos Aires", country: "Argentina", seniority: "C-Level" },
  current: { company: null, city: null, country: null, seniority: null },
  ...over,
});

test("fills the four empty fields from the lead row; company prefers display over raw", () => {
  const { fills, report } = planFiArgBackfill([row("l1", { source: { companyDisplay: "Acme Display", companyRaw: "Acme Raw", city: "Rosario", country: "Argentina", seniority: "Senior" } })]);
  assert.deepEqual(Object.fromEntries(fills.map((f) => [f.property, f.value])), { company: "Acme Display", city: "Rosario", country: "Argentina", seniority: "Senior" });
  assert.deepEqual(report.filled, { company: 1, city: 1, country: 1, seniority: 1 });
});

test("falls back to company_raw when there is no display name", () => {
  const { fills } = planFiArgBackfill([row("l1")]);
  assert.equal(fills.find((f) => f.property === "company")!.value, "Acme Raw");
});

test("never overwrites a value that is already set; whitespace-only counts as empty", () => {
  const { fills } = planFiArgBackfill([row("l1", { current: { company: "   ", city: "Mendoza", country: null, seniority: null } })]);
  assert.deepEqual(fills.map((f) => f.property).sort(), ["company", "country", "seniority"]);
});

test("an empty source value fills nothing (seniority is missing on some leads)", () => {
  const { fills, report } = planFiArgBackfill([row("l1", { source: { companyDisplay: null, companyRaw: "X", city: "C", country: "AR", seniority: null } })]);
  assert.equal(fills.some((f) => f.property === "seniority"), false);
  assert.equal(report.filled.seniority, 0);
});

test("leads without a person are their own count; out-of-scope persons are kept", () => {
  const { fills, report } = planFiArgBackfill([row("l1", { personId: null }), row("l2", { inScope: false }), row("l3")]);
  assert.equal(report.leads, 3);
  assert.equal(report.unmatched, 1);
  assert.equal(report.outOfScope, 1);
  assert.equal(report.matched, 1);
  assert.ok(fills.every((f) => f.personId === "p-l3"));
});

test("two leads on one person fill each empty field once, first lead wins", () => {
  const second = row("l2", { personId: "p-l1", source: { companyDisplay: null, companyRaw: "Other", city: "Other", country: "Other", seniority: "Other" } });
  const { fills } = planFiArgBackfill([row("l1"), second]);
  assert.equal(fills.length, 4);
  assert.equal(fills.find((f) => f.property === "city")!.value, "Buenos Aires");
});

test("planner never mutates its inputs and is repeatable", () => {
  const rows = [row("l1"), row("l2", { current: { company: "x", city: null, country: null, seniority: null } })];
  const snapshot = JSON.stringify(rows);
  assert.deepEqual(planFiArgBackfill(rows), planFiArgBackfill(rows));
  assert.equal(JSON.stringify(rows), snapshot);
});

test("source key constant is the one the import used", () => {
  assert.equal(FI_ARG_SOURCE_KEY, "fi-arg-2026");
});
