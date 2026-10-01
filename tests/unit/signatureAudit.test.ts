import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildSignatureAuditRow } from "../../src/lib/signature/audit";

const ME = "11111111-1111-4111-8111-111111111111";

test("records the actor, targets the same BD, and uses the signature action", () => {
  const row = buildSignatureAuditRow({ actorBdId: ME, before: null, after: "<p>Ana</p>" });
  assert.equal(row.actorBdId, ME);
  assert.equal(row.targetBdId, ME);
  assert.equal(row.action, "bd_signature_update");
});

test("metadata describes the change without storing the signature itself", () => {
  const row = buildSignatureAuditRow({ actorBdId: ME, before: "<p>old</p>", after: "<p>Ana</p>" });
  assert.deepEqual(row.metadata, {
    cleared: false,
    beforeLength: 10,
    afterLength: 10,
    afterSha256: createHash("sha256").update("<p>Ana</p>").digest("hex"),
  });
  assert.ok(!JSON.stringify(row.metadata).includes("Ana"));
});

test("clearing is recorded as cleared with no hash", () => {
  const row = buildSignatureAuditRow({ actorBdId: ME, before: "<p>old</p>", after: null });
  assert.deepEqual(row.metadata, { cleared: true, beforeLength: 10, afterLength: 0, afterSha256: null });
});

test("a first save has beforeLength 0", () => {
  const row = buildSignatureAuditRow({ actorBdId: ME, before: null, after: "<p>x</p>" });
  assert.equal(row.metadata.beforeLength, 0);
});
