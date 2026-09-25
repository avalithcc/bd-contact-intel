/**
 * Pure merge/unmerge planner (Phase 6; design.md D6, contact-identity R7,
 * duplicate-review spec) for the unified `person` model. `planMerge` folds
 * `merged` into `survivor`: property conflicts resolve via the existing
 * `mergeProperties`/`mergeProperty` rules (contact-identity R7, same
 * functions the migration and live resolver already use), the owner
 * follows the "earliest connector, lead-owner fallback" rule (R3), and
 * every reference (activity/task/signal/person_id_map/duplicate_candidate)
 * is moved set-based. The result carries a `snapshot` sufficient for
 * `planUnmerge` to reverse the merge EXACTLY — see task 6.4's round-trip
 * test in tests/unit/identityMerge.test.ts.
 *
 * No DB access here: the thin DB layer (./mergeDb.ts) reads the current
 * rows, calls these functions, and writes the resulting plan inside one
 * transaction.
 */
import { classifyPosition } from "@/lib/roleGroups";
import { mergeProperties, mergeProperty, type EmailStatus, type PropertyLoss } from "@/lib/identity/matcher";
import { parseConnectedOnDate } from "@/lib/migration/connectedOn";

// --- Row shapes (subset of src/db/schema.ts's person/personBdConnection) ---

export interface MergePersonFields {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailNormalized: string | null;
  emailStatus: EmailStatus;
  emailConfidence: number | null;
  emailSource: string | null;
  company: string | null;
  companyKey: string | null;
  companyCategory: string | null;
  jobTitle: string | null;
  roleGroup: string | null;
  seniority: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  ownerBdId: string | null;
  sourceKey: string | null;
}

export interface MergeConnection {
  personId: string;
  bdId: string;
  connectedOn: string | null;
  legacyContactId: string | null;
  messageCount: number;
  sentCount: number;
  receivedCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  initiatedByMe: boolean | null;
  reciprocal: boolean;
}

export interface MergeReferenceRow {
  table: "activity" | "task" | "signal";
  id: string;
}

export interface MergeIdMapRow {
  legacyTable: "contact" | "lead";
  legacyId: string;
}

export interface MergeDuplicateCandidateRow {
  id: string;
  personAId: string;
  personBId: string;
  status: string; // 'open' | 'merged' | 'not_duplicate'
}

export interface PlanMergeInput {
  survivor: MergePersonFields;
  merged: MergePersonFields;
  survivorConnections: readonly MergeConnection[];
  mergedConnections: readonly MergeConnection[];
  referencesOnMerged: readonly MergeReferenceRow[];
  idMapRowsOnMerged: readonly MergeIdMapRow[];
  // duplicate_candidate rows where merged.id is personAId or personBId.
  duplicateCandidatesInvolvingMerged: readonly MergeDuplicateCandidateRow[];
  // Ids of persons the survivor already has a duplicate_candidate pair with
  // (any status), excluding merged.id — lets the planner drop a repointed
  // pair that would collide with an existing survivor pair instead of
  // violating the unique (person_a_id, person_b_id) constraint.
  survivorPairedPersonIds: readonly string[];
}

export interface MergeSnapshot {
  survivor: MergePersonFields;
  merged: MergePersonFields;
  survivorConnections: readonly MergeConnection[];
  mergedConnections: readonly MergeConnection[];
  movedReferences: readonly MergeReferenceRow[];
  movedIdMapRows: readonly MergeIdMapRow[];
  repointedDuplicateCandidates: readonly MergeDuplicateCandidateRow[];
  droppedDuplicateCandidates: readonly MergeDuplicateCandidateRow[];
  mergedPairCandidate: { id: string; originalStatus: string } | null;
  propertyLosses: readonly PropertyLoss[];
}

export interface RepointedPair {
  id: string;
  personAId: string;
  personBId: string;
}

export interface MergePlan {
  survivorUpdate: Omit<MergePersonFields, "id">;
  ownerBdId: string | null;
  connectionsToRepoint: readonly MergeConnection[];
  connectionsToDrop: readonly MergeConnection[];
  referencesToRepoint: readonly MergeReferenceRow[];
  idMapRowsToRepoint: readonly MergeIdMapRow[];
  duplicateCandidatesToRepoint: readonly RepointedPair[];
  duplicateCandidatesToDrop: readonly string[];
  duplicateCandidateToMarkMerged: string | null;
  snapshot: MergeSnapshot;
}

function candidate(value: string | null, specificity?: number) {
  return { value, specificity };
}

/** Same "email fields move together" rule as identity/resolve.ts's mergeEmailFields, adapted for two full person rows. */
function mergeEmailFields(a: MergePersonFields, b: MergePersonFields) {
  const rank: Record<EmailStatus, number> = { verified: 2, probable: 1, none: 0 };
  const aHas = !!a.email;
  const bHas = !!b.email;
  const winner =
    aHas && !bHas ? a : bHas && !aHas ? b : !aHas && !bHas ? a : rank[b.emailStatus] > rank[a.emailStatus] ? b : a;
  const loser = winner === a ? b : a;
  const loss: PropertyLoss | null = loser.email && loser.email !== winner.email ? { property: "email", value: loser.email } : null;
  return {
    email: winner.email,
    emailNormalized: winner.emailNormalized,
    emailStatus: winner.emailStatus,
    emailConfidence: winner.emailConfidence,
    emailSource: winner.emailSource,
    loss,
  };
}

/** Earliest parsed connectedOn wins ownership (R3); no parseable connection falls back to the lead's existing owner. */
function pickOwner(survivor: MergePersonFields, merged: MergePersonFields, connections: readonly MergeConnection[]): string | null {
  let best: { bdId: string; time: number } | null = null;
  for (const c of connections) {
    const parsed = parseConnectedOnDate(c.connectedOn);
    if (!parsed) continue;
    const time = parsed.getTime();
    if (!best || time < best.time) best = { bdId: c.bdId, time };
  }
  return best?.bdId ?? survivor.ownerBdId ?? merged.ownerBdId;
}

function repointPair(candidate: MergeDuplicateCandidateRow, mergedId: string, survivorId: string): { personAId: string; personBId: string } {
  const a = candidate.personAId === mergedId ? survivorId : candidate.personAId;
  const b = candidate.personBId === mergedId ? survivorId : candidate.personBId;
  return a < b ? { personAId: a, personBId: b } : { personAId: b, personBId: a };
}

/**
 * Plans folding `merged` into `survivor` in one pass. Reversible: every
 * moved row and every losing property value is captured in the returned
 * `snapshot`, which `planUnmerge` replays in reverse.
 */
export function planMerge(input: PlanMergeInput): MergePlan {
  const { survivor, merged } = input;

  const stringFields: (keyof MergePersonFields)[] = [
    "firstName",
    "lastName",
    "company",
    "companyKey",
    "companyCategory",
    "seniority",
    "industry",
    "city",
    "region",
    "country",
    "sourceKey",
  ];
  const a: Record<string, ReturnType<typeof candidate>> = {};
  const b: Record<string, ReturnType<typeof candidate>> = {};
  for (const field of stringFields) {
    a[field] = candidate(survivor[field] as string | null);
    b[field] = candidate(merged[field] as string | null);
  }
  const jobTitleResult = mergeProperty(candidate(survivor.jobTitle), candidate(merged.jobTitle));
  const { merged: mergedFields, losers } = mergeProperties(a, b);
  const emailResult = mergeEmailFields(survivor, merged);
  const propertyLosses: PropertyLoss[] = [...losers];
  if (jobTitleResult.loser && jobTitleResult.loser.value != null) {
    propertyLosses.push({ property: "jobTitle", value: jobTitleResult.loser.value });
  }
  if (emailResult.loss) propertyLosses.push(emailResult.loss);

  const survivorUpdate: Omit<MergePersonFields, "id"> = {
    firstName: (mergedFields.firstName as string | null) ?? null,
    lastName: (mergedFields.lastName as string | null) ?? null,
    company: (mergedFields.company as string | null) ?? null,
    companyKey: (mergedFields.companyKey as string | null) ?? null,
    companyCategory: (mergedFields.companyCategory as string | null) ?? null,
    seniority: (mergedFields.seniority as string | null) ?? null,
    industry: (mergedFields.industry as string | null) ?? null,
    city: (mergedFields.city as string | null) ?? null,
    region: (mergedFields.region as string | null) ?? null,
    country: (mergedFields.country as string | null) ?? null,
    sourceKey: (mergedFields.sourceKey as string | null) ?? null,
    jobTitle: jobTitleResult.value ?? null,
    roleGroup: classifyPosition(jobTitleResult.value ?? null),
    email: emailResult.email,
    emailNormalized: emailResult.emailNormalized,
    emailStatus: emailResult.emailStatus,
    emailConfidence: emailResult.emailConfidence,
    emailSource: emailResult.emailSource,
    ownerBdId: pickOwner(survivor, merged, [...input.survivorConnections, ...input.mergedConnections]),
  };

  const survivorBdIds = new Set(input.survivorConnections.map((c) => c.bdId));
  const connectionsToRepoint = input.mergedConnections
    .filter((c) => !survivorBdIds.has(c.bdId))
    .map((c) => ({ ...c, personId: survivor.id }));
  const connectionsToDrop = input.mergedConnections.filter((c) => survivorBdIds.has(c.bdId));

  const survivorPaired = new Set(input.survivorPairedPersonIds);
  const duplicateCandidatesToRepoint: RepointedPair[] = [];
  const duplicateCandidatesToDrop: string[] = [];
  const repointedForSnapshot: MergeDuplicateCandidateRow[] = [];
  const droppedForSnapshot: MergeDuplicateCandidateRow[] = [];
  let mergedPairCandidate: { id: string; originalStatus: string } | null = null;

  for (const c of input.duplicateCandidatesInvolvingMerged) {
    const { personAId, personBId } = repointPair(c, merged.id, survivor.id);
    if (personAId === personBId) {
      // This candidate WAS the (survivor, merged) pair — it just got resolved by this merge.
      mergedPairCandidate = { id: c.id, originalStatus: c.status };
      continue;
    }
    const other = personAId === survivor.id ? personBId : personAId;
    if (survivorPaired.has(other)) {
      duplicateCandidatesToDrop.push(c.id);
      droppedForSnapshot.push(c);
      continue;
    }
    duplicateCandidatesToRepoint.push({ id: c.id, personAId, personBId });
    repointedForSnapshot.push(c);
  }

  const snapshot: MergeSnapshot = {
    survivor,
    merged,
    survivorConnections: input.survivorConnections,
    mergedConnections: input.mergedConnections,
    movedReferences: input.referencesOnMerged,
    movedIdMapRows: input.idMapRowsOnMerged,
    repointedDuplicateCandidates: repointedForSnapshot,
    droppedDuplicateCandidates: droppedForSnapshot,
    mergedPairCandidate,
    propertyLosses,
  };

  return {
    survivorUpdate,
    ownerBdId: survivorUpdate.ownerBdId,
    connectionsToRepoint,
    connectionsToDrop,
    referencesToRepoint: input.referencesOnMerged,
    idMapRowsToRepoint: input.idMapRowsOnMerged,
    duplicateCandidatesToRepoint,
    duplicateCandidatesToDrop,
    duplicateCandidateToMarkMerged: mergedPairCandidate?.id ?? null,
    snapshot,
  };
}

export interface UnmergePlan {
  survivorRestore: MergePersonFields;
  mergedRestore: MergePersonFields;
  // bdIds to delete from the survivor's connections (moved there by the merge).
  survivorBdIdsToRemove: readonly string[];
  // Full original connection rows to recreate on the merged person.
  mergedConnectionsRestore: readonly MergeConnection[];
  referencesToRepointBack: readonly MergeReferenceRow[];
  idMapRowsToRepointBack: readonly MergeIdMapRow[];
  duplicateCandidatesToRestore: readonly MergeDuplicateCandidateRow[];
  mergedPairCandidateToReopen: { id: string; originalStatus: string } | null;
}

/**
 * Replays a `MergeSnapshot` in reverse (task 6.2): restores both original
 * person rows, moves connections/references/id-map rows back onto `merged`,
 * and reverts duplicate_candidate repoints. References or id-map rows
 * created AFTER the merge are NOT in `snapshot.movedReferences`/
 * `movedIdMapRows` (those arrays are frozen at merge time), so they are
 * left untouched on the survivor — the minimal-safe interpretation of "keep
 * post-merge writes on the survivor" (design leaves this case unspecified).
 */
export function planUnmerge(snapshot: MergeSnapshot): UnmergePlan {
  const survivorBdIds = new Set(snapshot.survivorConnections.map((c) => c.bdId));
  const survivorBdIdsToRemove = snapshot.mergedConnections
    .map((c) => c.bdId)
    .filter((bdId) => !survivorBdIds.has(bdId));

  const restoredPairs: MergeDuplicateCandidateRow[] = snapshot.repointedDuplicateCandidates.map((c) => c);
  const restoredDropped: MergeDuplicateCandidateRow[] = snapshot.droppedDuplicateCandidates.map((c) => c);

  return {
    survivorRestore: snapshot.survivor,
    mergedRestore: snapshot.merged,
    survivorBdIdsToRemove,
    mergedConnectionsRestore: snapshot.mergedConnections,
    referencesToRepointBack: snapshot.movedReferences,
    idMapRowsToRepointBack: snapshot.movedIdMapRows,
    duplicateCandidatesToRestore: [...restoredPairs, ...restoredDropped],
    mergedPairCandidateToReopen: snapshot.mergedPairCandidate,
  };
}
