import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkApprovalGate } from "../../src/lib/sequences/bulkApprovalGate";

const rows = (...reviewed: boolean[]) => reviewed.map((r, i) => ({ id: `m${i + 1}`, reviewed: r }));

test("1 of 3 reviewed disables the bulk approve and names the unreviewed members", () => {
  const gate = bulkApprovalGate(rows(true, false, false));
  assert.deepEqual({ reviewed: gate.reviewed, total: gate.total, enabled: gate.enabled }, { reviewed: 1, total: 3, enabled: false });
  assert.deepEqual(gate.unreviewedIds, ["m2", "m3"]);
});

test("3 of 3 reviewed enables the bulk approve", () => {
  const gate = bulkApprovalGate(rows(true, true, true));
  assert.deepEqual({ reviewed: gate.reviewed, total: gate.total, enabled: gate.enabled }, { reviewed: 3, total: 3, enabled: true });
  assert.deepEqual(gate.unreviewedIds, []);
});

test("adding an unreviewed 4th row to a fully reviewed selection recomputes to 3 of 4, disabled", () => {
  const gate = bulkApprovalGate(rows(true, true, true, false));
  assert.deepEqual({ reviewed: gate.reviewed, total: gate.total, enabled: gate.enabled }, { reviewed: 3, total: 4, enabled: false });
});

test("an empty selection is never enabled", () => {
  assert.equal(bulkApprovalGate([]).enabled, false);
});

test("a duplicated id counts once", () => {
  const gate = bulkApprovalGate([{ id: "a", reviewed: true }, { id: "a", reviewed: false }]);
  assert.equal(gate.total, 1);
});
