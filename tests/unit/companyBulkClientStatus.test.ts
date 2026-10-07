/**
 * Unit tests for src/lib/companies/bulkClientStatus.ts — the pure decisions
 * behind the `/companies` bulk "Estado de cliente" action: value parsing,
 * the typed-count guard, id sanitizing, the idempotent plan (reuses the
 * single-record planner, so provenance rows are identical) and the audit row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIT_KEY_CAP,
  BULK_CLIENT_STATUS_CONFIRM_THRESHOLD,
  buildBulkClientStatusAuditRow,
  chunk,
  isCountConfirmed,
  parseBulkClientStatusValue,
  planBulkClientStatus,
  requiresCountConfirmation,
  sanitizeBulkCompanyKeys,
} from "@/lib/companies/bulkClientStatus";

const BD = "11111111-1111-1111-1111-111111111111";

test("parseBulkClientStatusValue: active/inactive pass, blank means NULL, anything else is invalid", () => {
  assert.equal(parseBulkClientStatusValue("active"), "active");
  assert.equal(parseBulkClientStatusValue("inactive"), "inactive");
  assert.equal(parseBulkClientStatusValue(""), null);
  assert.equal(parseBulkClientStatusValue("client"), undefined);
  assert.equal(parseBulkClientStatusValue("ACTIVE"), undefined);
});

test("requiresCountConfirmation: only strictly above the threshold", () => {
  assert.equal(requiresCountConfirmation(BULK_CLIENT_STATUS_CONFIRM_THRESHOLD), false);
  assert.equal(requiresCountConfirmation(BULK_CLIENT_STATUS_CONFIRM_THRESHOLD + 1), true);
  assert.equal(requiresCountConfirmation(0), false);
});

test("isCountConfirmed: exact number, tolerating thousands separators and spaces", () => {
  assert.equal(isCountConfirmed("14543", 14543), true);
  assert.equal(isCountConfirmed(" 14.543 ", 14543), true);
  assert.equal(isCountConfirmed("14,543", 14543), true);
  assert.equal(isCountConfirmed("14542", 14543), false);
  assert.equal(isCountConfirmed("", 14543), false);
  assert.equal(isCountConfirmed("1a4543", 14543), false);
  assert.equal(isCountConfirmed(null, 14543), false);
});

test("sanitizeBulkCompanyKeys: keeps non-empty strings, dedups, caps, ignores non-arrays", () => {
  assert.deepEqual(sanitizeBulkCompanyKeys(["acme", "acme", " ", 3, "globant"], 10), ["acme", "globant"]);
  assert.deepEqual(sanitizeBulkCompanyKeys(["a", "b", "c"], 2), ["a", "b"]);
  assert.deepEqual(sanitizeBulkCompanyKeys("acme", 10), []);
});

test("chunk: splits into bounded slices and never mutates the input", () => {
  const input = [1, 2, 3, 4, 5];
  assert.deepEqual(chunk(input, 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});

test("planBulkClientStatus: only rows whose value differs are updated and get a history row", () => {
  const rows = [
    { companyKey: "a", clientStatus: null },
    { companyKey: "b", clientStatus: "active" },
    { companyKey: "c", clientStatus: "inactive" },
  ];
  const plan = planBulkClientStatus(rows, "active", BD);
  assert.deepEqual(plan.toUpdate, ["a", "c"]);
  assert.deepEqual(plan.historyRows, [
    { companyKey: "a", property: "clientStatus", oldValue: null, newValue: "active", changedByBdId: BD, source: "edit" },
    { companyKey: "c", property: "clientStatus", oldValue: "inactive", newValue: "active", changedByBdId: BD, source: "edit" },
  ]);
});

test("planBulkClientStatus: NULL target clears the value and records the old one", () => {
  const plan = planBulkClientStatus(
    [{ companyKey: "a", clientStatus: "active" }, { companyKey: "b", clientStatus: null }],
    null,
    BD,
  );
  assert.deepEqual(plan.toUpdate, ["a"]);
  assert.equal(plan.historyRows[0]?.oldValue, "active");
  assert.equal(plan.historyRows[0]?.newValue, null);
});

test("planBulkClientStatus: everything already at the target is a no-op", () => {
  const plan = planBulkClientStatus([{ companyKey: "a", clientStatus: null }], null, BD);
  assert.deepEqual(plan, { toUpdate: [], historyRows: [] });
});

test("buildBulkClientStatusAuditRow: one row per run, count is uncapped while the key list is capped", () => {
  const keys = Array.from({ length: AUDIT_KEY_CAP + 5 }, (_, i) => `k${i}`);
  const row = buildBulkClientStatusAuditRow({
    actorBdId: BD,
    clientStatus: null,
    mode: "filter",
    filtersQuery: "stage=won",
    companyKeys: keys,
  });
  assert.equal(row.action, "bulk_client_status_change");
  assert.equal(row.actorBdId, BD);
  assert.equal(row.metadata.count, AUDIT_KEY_CAP + 5);
  assert.equal(row.metadata.companyKeys.length, AUDIT_KEY_CAP);
  assert.equal(row.metadata.truncated, true);
  assert.equal(row.metadata.clientStatus, null);
  assert.equal(row.metadata.filtersQuery, "stage=won");
});

test("buildBulkClientStatusAuditRow: filtersQuery is recorded only in filter mode", () => {
  const row = buildBulkClientStatusAuditRow({
    actorBdId: BD,
    clientStatus: "active",
    mode: "ids",
    filtersQuery: "stage=won",
    companyKeys: ["a"],
  });
  assert.equal("filtersQuery" in row.metadata, false);
  assert.equal(row.metadata.truncated, false);
});
