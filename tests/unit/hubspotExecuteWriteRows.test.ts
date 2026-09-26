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
import { buildIdentityWriteRows, personIdMapKey, type IdentityWritePlan } from "@/lib/identity/resolve";
import type { HubSpotStatusEvidenceOutcome } from "@/lib/hubspot/planner";

/** Builds a `legacyIdToPersonId` test map the SAME way the real producer
 * (`applyIdentityWrites` in resolveDb.ts) does — via `personIdMapKey` — so
 * these tests exercise the actual consumer/producer key contract instead of
 * mirroring the consumer's (previously buggy) lookup format. */
function hubspotPersonIdMapKey(hubspotContactId: string): string {
  return personIdMapKey("hubspot_contact", hubspotLegacyId(hubspotContactId));
}

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
      unknownLeadStatus: null,
    },
    ...overrides,
  };
}

test("a new row's plan-local ref resolves to the created person's real uuid via legacyIdToPersonId", () => {
  const o = outcome({ hubspotContactId: "1", personRef: "np1" });
  const legacyIdToPersonId = new Map([[hubspotPersonIdMapKey("1"), REAL_UUID_1]]);
  assert.equal(resolveStatusEvidencePersonId(o, legacyIdToPersonId), REAL_UUID_1);
});

test("a review row's plan-local ref resolves the same way as a new row", () => {
  const o = outcome({ hubspotContactId: "2", personRef: "np7" });
  const legacyIdToPersonId = new Map([[hubspotPersonIdMapKey("2"), REAL_UUID_2]]);
  assert.equal(resolveStatusEvidencePersonId(o, legacyIdToPersonId), REAL_UUID_2);
});

test("an auto/existing match keeps the existing real id (map entry equals personRef already)", () => {
  const o = outcome({ hubspotContactId: "3", personRef: EXISTING_UUID });
  const legacyIdToPersonId = new Map([[hubspotPersonIdMapKey("3"), EXISTING_UUID]]);
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
        unknownLeadStatus: null,
      },
    }),
  ];
  const legacyIdToPersonId = new Map([[hubspotPersonIdMapKey("1"), REAL_UUID_1]]);
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
  const legacyIdToPersonId = new Map([[hubspotPersonIdMapKey("1"), REAL_UUID_1]]);
  assert.deepEqual(resolveTouchedPersonIds(outcomes, legacyIdToPersonId), [REAL_UUID_1]);
});

// --- Integration-style: the real producer -> real consumer contract --------

const emptyMerged = {
  firstName: null,
  lastName: null,
  company: null,
  companyKey: null,
  jobTitle: null,
  roleGroup: "other" as const,
  industry: null,
  email: null,
  emailNormalized: null,
  emailStatus: "none" as const,
  emailConfidence: null,
  emailSource: null,
  city: null,
  country: null,
  ownerBdId: null,
};

/**
 * Reproduces the ACTUAL production data flow end to end, pure (no DB): takes
 * the same `IdentityWritePlan` shape `planIdentityWrites` produces, runs it
 * through the real producer (`buildIdentityWriteRows`), derives
 * `legacyIdToPersonId` the exact same way `applyIdentityWrites` does (via
 * `personIdMapKey`), then resolves status evidence for a brand-new row, a
 * review row, and an already-matched existing row. This is the exact
 * scenario that broke in production (`np51`-class `NonUuidPersonIdError`):
 * if the producer's key format and the consumer's lookup key ever drift
 * apart again, this test fails without needing a live database.
 */
test("the real producer -> real consumer contract resolves new, review and existing rows to real uuids", () => {
  const plan: IdentityWritePlan = {
    rowOutcomes: [
      {
        row: { legacyTable: "hubspot_contact", legacyId: hubspotLegacyId("101"), bdId: null, firstName: "New", lastName: "Person", company: null, email: null, emailStatus: "none" },
        method: "new",
        personRef: "np1",
      },
      {
        row: { legacyTable: "hubspot_contact", legacyId: hubspotLegacyId("102"), bdId: null, firstName: "Review", lastName: "Person", company: null, email: null, emailStatus: "none" },
        method: "review",
        personRef: "np2",
      },
      {
        row: { legacyTable: "hubspot_contact", legacyId: hubspotLegacyId("103"), bdId: null, firstName: "Existing", lastName: "Match", company: null, email: null, emailStatus: "none" },
        method: "profile_key",
        personRef: EXISTING_UUID,
      },
    ],
    newPersons: [
      { planRef: "np1", profileKey: null, sourceKey: "hubspot_import", merged: emptyMerged, migrationRunId: null },
      { planRef: "np2", profileKey: null, sourceKey: "hubspot_import", merged: emptyMerged, migrationRunId: null },
    ],
    existingUpdates: [],
    reviewPairs: [],
    report: { rowsRead: 3, ownCompanySkipped: 0, autoMerged: 1, flaggedForReview: 1, new: 1 },
  };

  let seq = 0;
  const newId = () => [REAL_UUID_1, REAL_UUID_2][seq++];
  const builtRows = buildIdentityWriteRows(plan, newId);

  // Same derivation applyIdentityWrites (resolveDb.ts) performs after insert.
  const legacyIdToPersonId = new Map<string, string>();
  for (const row of builtRows.idMap) {
    if (!row.personId) continue;
    legacyIdToPersonId.set(personIdMapKey(row.legacyTable as "hubspot_contact", row.legacyId), row.personId);
  }

  const newOutcome = outcome({ hubspotContactId: "101", personRef: "np1" });
  const reviewOutcome = outcome({ hubspotContactId: "102", personRef: "np2" });
  const existingOutcome = outcome({ hubspotContactId: "103", personRef: EXISTING_UUID });

  assert.equal(resolveStatusEvidencePersonId(newOutcome, legacyIdToPersonId), REAL_UUID_1);
  assert.equal(resolveStatusEvidencePersonId(reviewOutcome, legacyIdToPersonId), REAL_UUID_2);
  assert.equal(resolveStatusEvidencePersonId(existingOutcome, legacyIdToPersonId), EXISTING_UUID);
});
