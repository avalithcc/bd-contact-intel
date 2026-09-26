/**
 * Unit tests for src/lib/hubspot/executeWriteRows.ts (fresh-review CRITICAL
 * fix: plan-local refs like "np1" — resolve.ts's `IdentityWritePlan`
 * plan refs — must never be written as a real `person_id` into `activity`
 * or passed to `recomputePersonStatuses`). Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStatusBackfillActivityRows,
  NonUuidPersonIdError,
  resolveStatusEvidencePersonId,
  resolveTouchedPersonIds,
} from "@/lib/hubspot/executeWriteRows";
import { hubspotLegacyId } from "@/lib/hubspot/uuidv5";
import type { HubSpotStatusEvidenceOutcome } from "@/lib/hubspot/planner";

const REAL_UUID_1 = "11111111-1111-1111-1111-111111111111";
const REAL_UUID_2 = "22222222-2222-2222-2222-222222222222";
const EXISTING_UUID = "33333333-3333-3333-3333-333333333333";

function outcome(overrides: Partial<HubSpotStatusEvidenceOutcome> = {}): HubSpotStatusEvidenceOutcome {
  return {
    hubspotContactId: "1",
    personRef: "np1",
    plan: {
      activities: [
        {
          status: "contacted",
          idempotencyKey: "1:contacted",
          metadata: {
            status: "contacted",
            originalEditorBdId: null,
            originalAt: "2026-01-01T00:00:00.000Z",
            source: "hubspot_import",
            hubspotContactId: "1",
          },
        },
      ],
      originalAt: new Date("2026-01-01T00:00:00.000Z"),
      dateFallback: false,
    },
    ...overrides,
  };
}

test("a new row's plan-local ref resolves to the created person's real uuid via legacyIdToPersonId", () => {
  const o = outcome({ hubspotContactId: "1", personRef: "np1" });
  const legacyIdToPersonId = new Map([[hubspotLegacyId("1"), REAL_UUID_1]]);
  assert.equal(resolveStatusEvidencePersonId(o, legacyIdToPersonId), REAL_UUID_1);
});

test("a review row's plan-local ref resolves the same way as a new row", () => {
  const o = outcome({ hubspotContactId: "2", personRef: "np7" });
  const legacyIdToPersonId = new Map([[hubspotLegacyId("2"), REAL_UUID_2]]);
  assert.equal(resolveStatusEvidencePersonId(o, legacyIdToPersonId), REAL_UUID_2);
});

test("an auto/existing match keeps the existing real id (map entry equals personRef already)", () => {
  const o = outcome({ hubspotContactId: "3", personRef: EXISTING_UUID });
  const legacyIdToPersonId = new Map([[hubspotLegacyId("3"), EXISTING_UUID]]);
  assert.equal(resolveStatusEvidencePersonId(o, legacyIdToPersonId), EXISTING_UUID);
});

test("an already_imported row with no legacyIdToPersonId entry falls back to its real personRef", () => {
  const o = outcome({ hubspotContactId: "4", personRef: EXISTING_UUID });
  assert.equal(resolveStatusEvidencePersonId(o, new Map()), EXISTING_UUID);
});

test("the guard rejects a non-uuid personId — a plan ref that was never resolved", () => {
  const o = outcome({ hubspotContactId: "5", personRef: "np99" });
  assert.throws(
    () => resolveStatusEvidencePersonId(o, new Map()),
    (err: unknown) => err instanceof NonUuidPersonIdError && err.personId === "np99",
  );
});

test("buildStatusBackfillActivityRows never writes a plan-local ref as personId", () => {
  const outcomes = [
    outcome({ hubspotContactId: "1", personRef: "np1" }),
    outcome({
      hubspotContactId: "2",
      personRef: EXISTING_UUID,
      plan: {
        activities: [
          {
            status: "replied",
            idempotencyKey: "2:replied",
            metadata: {
              status: "replied",
              originalEditorBdId: null,
              originalAt: "2026-01-02T00:00:00.000Z",
              source: "hubspot_import",
              hubspotContactId: "2",
            },
          },
        ],
        originalAt: new Date("2026-01-02T00:00:00.000Z"),
        dateFallback: false,
      },
    }),
  ];
  const legacyIdToPersonId = new Map([[hubspotLegacyId("1"), REAL_UUID_1]]);
  const rows = buildStatusBackfillActivityRows(outcomes, legacyIdToPersonId, new Set());
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.personId as string, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
  assert.equal(rows[0].personId, REAL_UUID_1);
  assert.equal(rows[1].personId, EXISTING_UUID);
});

test("buildStatusBackfillActivityRows skips an activity whose idempotency key already exists", () => {
  const outcomes = [outcome({ hubspotContactId: "1", personRef: EXISTING_UUID })];
  const rows = buildStatusBackfillActivityRows(outcomes, new Map(), new Set(["1:contacted"]));
  assert.equal(rows.length, 0);
});

test("resolveTouchedPersonIds resolves every outcome the same way as the activity rows", () => {
  const outcomes = [outcome({ hubspotContactId: "1", personRef: "np1" })];
  const legacyIdToPersonId = new Map([[hubspotLegacyId("1"), REAL_UUID_1]]);
  assert.deepEqual(resolveTouchedPersonIds(outcomes, legacyIdToPersonId), [REAL_UUID_1]);
});
