import assert from "node:assert/strict";
import { test } from "node:test";
import { SEQUENCE_AUDIT_ACTIONS, sequenceAuditRow } from "../../src/lib/sequences/approvalAudit";

const at = new Date("2026-10-14T15:00:00Z");

for (const verb of ["approve", "cancel", "discard", "readmit", "regenerate"] as const) {
  test(`${verb} writes the actor BD and the timestamp`, () => {
    const row = sequenceAuditRow(verb, { actorBdId: "bd-1", personId: "p-1", memberId: "m-1", sequenceId: "s-1", step: 1, at });
    assert.equal(row.action, SEQUENCE_AUDIT_ACTIONS[verb]);
    assert.equal(row.actorBdId, "bd-1");
    assert.equal(row.personId, "p-1");
    assert.equal(row.at, at);
    assert.deepEqual(row.metadata, { memberId: "m-1", sequenceId: "s-1", step: 1 });
  });
}

test("every audit verb maps to its own action string, so no two acts are logged as the same thing", () => {
  const verbs = Object.keys(SEQUENCE_AUDIT_ACTIONS);
  assert.equal(new Set(Object.values(SEQUENCE_AUDIT_ACTIONS)).size, verbs.length);
  // Named rather than counted: a count only catches a DUPLICATE when someone also adds a verb, and the pair that
  // matters here is regenerate / regenerate_subject — same consequence, different act, and they must stay distinct.
  assert.notEqual(SEQUENCE_AUDIT_ACTIONS.regenerate, SEQUENCE_AUDIT_ACTIONS.regenerate_subject);
});
