/**
 * Unit tests for src/lib/reports/wonCompaniesDrilldown.ts — the "Empresas
 * ganadas" KPI drilldown's pure row normalizer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWonCompanyDrilldownRows, type WonCompanyDrilldownRawRow } from "@/lib/reports/wonCompaniesDrilldown";

const BASE: WonCompanyDrilldownRawRow = {
  companyKey: "acme",
  displayName: "Acme SA",
  ownerBdId: "bd-1",
  ownerBdName: "Ana",
  wonAt: "2026-09-15T12:00:00.000Z",
  wonAtExact: true,
};

test("buildWonCompanyDrilldownRows normalizes a raw-SQL timestamp string into a real Date", () => {
  const [row] = buildWonCompanyDrilldownRows([BASE]);
  assert.ok(row!.wonAt instanceof Date);
  assert.equal(row!.wonAt.toISOString(), "2026-09-15T12:00:00.000Z");
});

test("buildWonCompanyDrilldownRows leaves an already-Date wonAt untouched", () => {
  const at = new Date("2026-09-01T00:00:00.000Z");
  const [row] = buildWonCompanyDrilldownRows([{ ...BASE, wonAt: at }]);
  assert.equal(row!.wonAt, at);
});

test("buildWonCompanyDrilldownRows preserves wonAtExact=false (updated_at fallback, no status_change row found)", () => {
  const [row] = buildWonCompanyDrilldownRows([{ ...BASE, wonAtExact: false }]);
  assert.equal(row!.wonAtExact, false);
});

test("buildWonCompanyDrilldownRows never mutates its input array (pure planner rule)", () => {
  const input = [BASE];
  const clone = JSON.parse(JSON.stringify(input));
  buildWonCompanyDrilldownRows(input);
  assert.deepEqual(input, clone);
});

test("buildWonCompanyDrilldownRows preserves a null owner (unowned won company)", () => {
  const [row] = buildWonCompanyDrilldownRows([{ ...BASE, ownerBdId: null, ownerBdName: null }]);
  assert.equal(row!.ownerBdId, null);
  assert.equal(row!.ownerBdName, null);
});
