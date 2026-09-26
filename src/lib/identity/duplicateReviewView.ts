/**
 * Pure view-model pieces for the /admin/duplicates review queue (Phase 7
 * task 7.2; duplicate-review spec's merge path). Two responsibilities:
 *
 * - `chooseDefaultSurvivor` decides which side of a possible-duplicate pair
 *   the review UI recommends as the merge survivor. The spec and design.md
 *   leave this unspecified for the manual-review path (unlike the collapse
 *   migration's "earliest connector" owner rule); this mirrors the rule the
 *   approved mockup's compare-panel prose documents: "A survives — it has
 *   the LinkedIn profile and the earliest connection."
 * - `previewMergeOutcome` renders the compare panel's "who wins each field"
 *   result BEFORE a merge is confirmed, by reusing the already-tested
 *   `planMerge` (tests/unit/identityMerge.test.ts) rather than
 *   reimplementing the property-conflict rules. Reference/id-map/duplicate-
 *   candidate movement is irrelevant to a read-only preview, so those
 *   planMerge inputs are passed empty.
 */
import { parseConnectedOnDate } from "@/lib/migration/connectedOn";
import { planMerge, type MergeConnection, type MergePersonFields, type MergePlan } from "@/lib/identity/merge";

export type DuplicateReviewSide = "a" | "b";

export interface SurvivorCandidate {
  id: string;
  profileKey: string | null;
  createdAt: Date;
}

function earliestConnectedOn(connections: readonly { connectedOn: string | null }[]): Date | null {
  let earliest: Date | null = null;
  for (const c of connections) {
    const parsed = parseConnectedOnDate(c.connectedOn);
    if (parsed && (!earliest || parsed < earliest)) earliest = parsed;
  }
  return earliest;
}

export function chooseDefaultSurvivor(
  a: SurvivorCandidate,
  aConnections: readonly { connectedOn: string | null }[],
  b: SurvivorCandidate,
  bConnections: readonly { connectedOn: string | null }[],
): DuplicateReviewSide {
  if (a.profileKey && !b.profileKey) return "a";
  if (b.profileKey && !a.profileKey) return "b";

  const aEarliest = earliestConnectedOn(aConnections);
  const bEarliest = earliestConnectedOn(bConnections);
  if (aEarliest && (!bEarliest || aEarliest < bEarliest)) return "a";
  if (bEarliest && (!aEarliest || bEarliest < aEarliest)) return "b";

  if (a.createdAt.getTime() < b.createdAt.getTime()) return "a";
  if (b.createdAt.getTime() < a.createdAt.getTime()) return "b";

  return "a";
}

export interface DuplicatePairPreviewInput {
  survivor: MergePersonFields;
  survivorConnections: readonly MergeConnection[];
  merged: MergePersonFields;
  mergedConnections: readonly MergeConnection[];
}

export function previewMergeOutcome(input: DuplicatePairPreviewInput): MergePlan {
  return planMerge({
    survivor: input.survivor,
    merged: input.merged,
    survivorConnections: input.survivorConnections,
    mergedConnections: input.mergedConnections,
    referencesOnMerged: [],
    idMapRowsOnMerged: [],
    duplicateCandidatesInvolvingMerged: [],
    survivorPairedPersonIds: [],
  });
}
