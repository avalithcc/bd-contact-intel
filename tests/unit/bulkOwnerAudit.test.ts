/**
 * Unit tests for src/lib/contacts/bulkOwnerAudit.ts — the audit_log row
 * every bulk "Asignar responsable" writes (owner-approved requirement).
 * Pure row builder only — no DB; bulkOwnerDb.ts calls this and inserts the
 * result inside the same transaction as the person.owner_bd_id update.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIT_LOG_ID_CAP, buildBulkOwnerAuditRow } from "@/lib/contacts/bulkOwnerAudit";

const actorBdId = "actor-1";
const ownerBdId = "new-owner-1";

test("buildBulkOwnerAuditRow: explicit-ids mode records the actor, action, new owner, count, mode, and the affected ids", () => {
  const row = buildBulkOwnerAuditRow({
    actorBdId,
    ownerBdId,
    mode: "ids",
    personIds: ["p1", "p2", "p3"],
  });
  assert.equal(row.actorBdId, actorBdId);
  assert.equal(row.action, "bulk_owner_change");
  assert.equal(row.targetBdId, ownerBdId);
  assert.equal(row.metadata.count, 3);
  assert.equal(row.metadata.mode, "ids");
  assert.deepEqual(row.metadata.personIds, ["p1", "p2", "p3"]);
  assert.equal(row.metadata.truncated, false);
  assert.equal("filtersQuery" in row.metadata, false);
});

test("buildBulkOwnerAuditRow: filter-wide mode also records the filtersQuery", () => {
  const row = buildBulkOwnerAuditRow({
    actorBdId,
    ownerBdId,
    mode: "filter",
    filtersQuery: "status=new&owner=me",
    personIds: ["p1", "p2"],
  });
  assert.equal(row.metadata.mode, "filter");
  assert.equal(row.metadata.filtersQuery, "status=new&owner=me");
  assert.equal(row.metadata.count, 2);
});

test("buildBulkOwnerAuditRow: unassign (ownerBdId null) still writes a row, targetBdId null", () => {
  const row = buildBulkOwnerAuditRow({ actorBdId, ownerBdId: null, mode: "ids", personIds: ["p1"] });
  assert.equal(row.targetBdId, null);
});

test("buildBulkOwnerAuditRow: a large affected list is capped in metadata.personIds, but metadata.count always reflects the FULL count and metadata.truncated is true", () => {
  const ids = Array.from({ length: AUDIT_LOG_ID_CAP + 25 }, (_, i) => `p${i}`);
  const row = buildBulkOwnerAuditRow({ actorBdId, ownerBdId, mode: "filter", filtersQuery: "x=1", personIds: ids });
  assert.equal(row.metadata.count, AUDIT_LOG_ID_CAP + 25);
  assert.equal(row.metadata.personIds.length, AUDIT_LOG_ID_CAP);
  assert.deepEqual(row.metadata.personIds, ids.slice(0, AUDIT_LOG_ID_CAP));
  assert.equal(row.metadata.truncated, true);
});

test("buildBulkOwnerAuditRow: an id list at exactly the cap is not flagged as truncated", () => {
  const ids = Array.from({ length: AUDIT_LOG_ID_CAP }, (_, i) => `p${i}`);
  const row = buildBulkOwnerAuditRow({ actorBdId, ownerBdId, mode: "ids", personIds: ids });
  assert.equal(row.metadata.truncated, false);
  assert.equal(row.metadata.personIds.length, AUDIT_LOG_ID_CAP);
});
