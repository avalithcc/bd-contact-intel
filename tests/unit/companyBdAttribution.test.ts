/**
 * Unit tests for src/lib/reports/companyBdAttribution.ts — the "Empresas
 * ganadas"/"Pipeline de empresas" company-to-BD rollup (prod bug fix
 * 2026-09-30: both real won companies have no company.owner_bd_id set).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { companyBelongsToBd, type CompanyBdAttributionInput } from "@/lib/reports/companyBdAttribution";

test("companyBelongsToBd: bdId=null (Todos los BDs) always counts, regardless of ownership", () => {
  const input: CompanyBdAttributionInput = { companyOwnerBdId: null, personOwnerBdIds: [] };
  assert.equal(companyBelongsToBd(input, null), true);
});

test("companyBelongsToBd: counts when company.owner_bd_id matches directly", () => {
  const input: CompanyBdAttributionInput = { companyOwnerBdId: "bd-1", personOwnerBdIds: [] };
  assert.equal(companyBelongsToBd(input, "bd-1"), true);
});

test("companyBelongsToBd: Datapar case — no company owner, but a person at the company is owned by this BD", () => {
  const input: CompanyBdAttributionInput = { companyOwnerBdId: null, personOwnerBdIds: ["bd-1"] };
  assert.equal(companyBelongsToBd(input, "bd-1"), true);
});

test("companyBelongsToBd: false when neither the company nor any of its people are owned by this BD", () => {
  const input: CompanyBdAttributionInput = { companyOwnerBdId: "bd-2", personOwnerBdIds: ["bd-3", null] };
  assert.equal(companyBelongsToBd(input, "bd-1"), false);
});

test("companyBelongsToBd: matches on ANY person owner among several, not just the first", () => {
  const input: CompanyBdAttributionInput = { companyOwnerBdId: null, personOwnerBdIds: [null, "bd-2", "bd-1"] };
  assert.equal(companyBelongsToBd(input, "bd-1"), true);
});

test("companyBelongsToBd: never mutates its input (pure planner rule)", () => {
  const input: CompanyBdAttributionInput = { companyOwnerBdId: "bd-2", personOwnerBdIds: ["bd-3"] };
  const clone = JSON.parse(JSON.stringify(input));
  companyBelongsToBd(input, "bd-1");
  assert.deepEqual(input, clone);
});
