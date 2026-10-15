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

test("the six actions map to distinct audit actions", () => {
  assert.equal(new Set(Object.values(SEQUENCE_AUDIT_ACTIONS)).size, 6);
});
