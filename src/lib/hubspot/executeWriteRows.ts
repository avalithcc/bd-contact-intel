/**
 * Pure write-row resolution for `finalizeHubSpotExecute` (fresh-review
 * CRITICAL fix — the "np1"-class bug): resolve.ts's `IdentityWritePlan`
 * gives `new`/`review` rows a PLAN-LOCAL ref (e.g. `"np1"`, resolve.ts
 * `planIdentityWrites`) that only becomes a real `person.id` once
 * `applyIdentityWrites` has actually inserted the row (and, on a
 * conflict-loser race, been repointed to the winner). `planner.ts`'s
 * `HubSpotStatusEvidenceOutcome.personRef` carries that SAME duality — a
 * real id for `already_imported`/auto-matched rows, a plan ref for
 * `new`/`review` rows — so writing it straight into `activity.person_id` or
 * `recomputePersonStatuses` is wrong for exactly the rows that just got a
 * fresh `person` row created for them.
 *
 * `legacyIdToPersonId` is the fix: `applyIdentityWrites` (resolveDb.ts)
 * returns the FINAL, post-conflict-repoint `person_id_map` rows it just
 * wrote, keyed by `personIdMapKey(legacyTable, legacyId)` — that already
 * resolves every ref (plan or real) to the real inserted/matched id, for
 * every row outcome except `skipped_own_company`. `importQueries.ts` wires
 * this module against that map; everything here is pure and unit-tested,
 * mirroring collapseWriteRows.ts/foldWriteRows.ts.
 *
 * PR H7 fix: the lookup key here MUST be built with the SAME
 * `personIdMapKey` helper the producer (`applyIdentityWrites`) uses — a
 * bare `hubspotLegacyId(...)` with no `hubspot_contact:` table prefix
 * silently misses every entry (`np51`-class production bug: a real
 * `execute` aborted with `NonUuidPersonIdError` because every lookup
 * missed and fell back to an unresolved plan ref).
 */
import { isUuid } from "@/lib/uuid";
import { hubspotLegacyId } from "@/lib/hubspot/uuidv5";
import { personIdMapKey } from "@/lib/identity/resolve";
import type { HubSpotStatusEvidenceOutcome } from "@/lib/hubspot/planner";
import type { activity } from "@/db/schema";

export class NonUuidPersonIdError extends Error {
  constructor(
    public readonly context: string,
    public readonly personId: string,
  ) {
    super(`hubspot_import execute: refusing to write a non-uuid personId (${context}): ${personId}`);
    this.name = "NonUuidPersonIdError";
  }
}

/** Defensive guard (fresh-review requirement): throws before ANY write if
 * the resolved id is not uuid-shaped — the last line of defense against
 * this exact class of bug recurring. */
export function assertPersonUuid(personId: string, context: string): void {
  if (!isUuid(personId)) throw new NonUuidPersonIdError(context, personId);
}

/**
 * Resolves one status-evidence outcome's real person id.
 * `already_imported` and auto-matched rows already carry a real id on
 * `personRef` (a `legacyIdToPersonId` lookup for them, when present, is a
 * no-op — the map is keyed by the SAME real id). `new`/`review` rows carry
 * a plan-local ref that ONLY resolves through `legacyIdToPersonId` — if
 * that lookup misses for such a row, `personRef` is still a plan ref, and
 * the guard below throws rather than let it reach a DB write.
 */
export function resolveStatusEvidencePersonId(
  outcome: HubSpotStatusEvidenceOutcome,
  legacyIdToPersonId: ReadonlyMap<string, string>,
): string {
  const mapped = legacyIdToPersonId.get(personIdMapKey("hubspot_contact", hubspotLegacyId(outcome.hubspotContactId)));
  const personId = mapped ?? outcome.personRef;
  assertPersonUuid(personId, `status_backfill activity for hubspotContactId=${outcome.hubspotContactId}`);
  return personId;
}

/** Insert-ready `status_backfill` activity rows (task 3.7's idempotency:
 * skips any activity whose `(hubspotContactId, status)` key already
 * exists), every `personId` resolved through `resolveStatusEvidencePersonId`
 * first — never a raw plan ref. */
export function buildStatusBackfillActivityRows(
  statusEvidence: readonly HubSpotStatusEvidenceOutcome[],
  legacyIdToPersonId: ReadonlyMap<string, string>,
  existingActivityKeys: ReadonlySet<string>,
): (typeof activity.$inferInsert)[] {
  const rows: (typeof activity.$inferInsert)[] = [];
  for (const outcome of statusEvidence) {
    const personId = resolveStatusEvidencePersonId(outcome, legacyIdToPersonId);
    for (const a of outcome.plan.activities) {
      if (existingActivityKeys.has(a.idempotencyKey)) continue;
      rows.push({ personId, actorBdId: null, type: "status_backfill", metadata: a.metadata });
    }
  }
  return rows;
}

/** The person ids `recomputePersonStatuses` must touch for the
 * status-evidence side of the plan — same resolution as the activity rows,
 * so a plan-local ref can never leak into the recompute call either. */
export function resolveTouchedPersonIds(
  statusEvidence: readonly HubSpotStatusEvidenceOutcome[],
  legacyIdToPersonId: ReadonlyMap<string, string>,
): string[] {
  return statusEvidence.map((outcome) => resolveStatusEvidencePersonId(outcome, legacyIdToPersonId));
}
