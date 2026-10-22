/**
 * Unit tests for src/lib/lusha/revealsDrilldown.ts, the pure row normalizer behind the
 * "Revelados" drill-down on /admin/lusha.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRevealDrilldownRows, type RevealDrilldownRawRow } from "@/lib/lusha/revealsDrilldown";

const BASE: RevealDrilldownRawRow = {
  rd_reveal_id: "r-1",
  rd_person_id: "p-1",
  rd_person_name: "Marta Olivera",
  rd_company: "Nodo Labs",
  rd_field: "emails",
  rd_value: "marta.olivera@nodolabs.example",
  rd_actor_bd_id: "bd-1",
  rd_actor_bd_name: "Lucia Ferran",
  rd_at: "2026-10-22 12:00:00.123456+00",
  rd_credits_charged: "1",
};

test("maps a raw-SQL row: timestamp string to a real Date, bigint-ish credits to a number", () => {
  const [row] = buildRevealDrilldownRows([BASE]);
  assert.ok(row!.at instanceof Date);
  assert.equal(row!.at.toISOString(), "2026-10-22T12:00:00.123Z");
  assert.equal(row!.creditsCharged, 1);
  assert.equal(row!.revealId, "r-1");
  assert.equal(row!.personId, "p-1");
  assert.equal(row!.personName, "Marta Olivera");
  assert.equal(row!.company, "Nodo Labs");
  assert.equal(row!.field, "emails");
  assert.equal(row!.value, "marta.olivera@nodolabs.example");
  assert.equal(row!.actorBdId, "bd-1");
  assert.equal(row!.actorBdName, "Lucia Ferran");
});

test("leaves an already-Date timestamp untouched", () => {
  const at = new Date("2026-10-01T00:00:00.000Z");
  const [row] = buildRevealDrilldownRows([{ ...BASE, rd_at: at }]);
  assert.equal(row!.at, at);
});

test("a null credits_charged stays null (pending charge), never 0", () => {
  const [row] = buildRevealDrilldownRows([{ ...BASE, rd_credits_charged: null }]);
  assert.equal(row!.creditsCharged, null);
});

test("a charge of 0 is a real 0, not pending", () => {
  const [row] = buildRevealDrilldownRows([{ ...BASE, rd_credits_charged: 0 }]);
  assert.equal(row!.creditsCharged, 0);
});

test("keeps a null company and a null value", () => {
  const [row] = buildRevealDrilldownRows([{ ...BASE, rd_company: null, rd_value: null }]);
  assert.equal(row!.company, null);
  assert.equal(row!.value, null);
});

test("preserves the SQL order and never mutates its input", () => {
  const input = [BASE, { ...BASE, rd_reveal_id: "r-2", rd_field: "phones" as const }];
  const clone = JSON.parse(JSON.stringify(input));
  const first = buildRevealDrilldownRows(input);
  const second = buildRevealDrilldownRows(input);
  assert.deepEqual(input, clone);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((r) => r.revealId), ["r-1", "r-2"]);
});

test("parses a timestamp the same on a non-UTC runtime", () => {
  const prev = process.env.TZ;
  process.env.TZ = "America/Argentina/Buenos_Aires";
  try {
    const [row] = buildRevealDrilldownRows([{ ...BASE, rd_at: "2026-10-22 12:00:00+00" }]);
    assert.equal(row!.at.toISOString(), "2026-10-22T12:00:00.000Z");
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});
