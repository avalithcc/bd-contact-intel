/**
 * Pure merge/unmerge planner (Phase 6; design.md D6, contact-identity R7,
 * duplicate-review spec) for the unified `person` model. `planMerge` folds
 * `merged` into `survivor`: property conflicts resolve via the existing
 * `mergeProperties`/`mergeProperty` rules (contact-identity R7, same
 * functions the migration and live resolver already use), the owner
 * follows the "earliest connector, lead-owner fallback" rule (R3), and
 * every reference (activity/task/signal/person_id_map/duplicate_candidate)
 * is moved set-based.
 *
 * Safe unmerge (fresh-review fix): the snapshot records field-level and
 * connection-level "before" AND "written" values instead of freezing whole
 * rows. `planUnmerge` only reverts a survivor field or connection if its
 * CURRENT value still equals what the merge wrote — anything edited or
 * accumulated after the merge (a later merge, a manual edit, new messages)
 * is kept and reported instead of silently overwritten. The merged person
 * itself is restored fully: it was hidden (`merged_into_id` set) the whole
 * time, so nothing could have edited it.
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

type PersonField = keyof Omit<MergePersonFields, "id">;
type PersonFieldValue = string | number | null;

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

/** One survivor field the merge changed: the value before, and the value written. */
export interface SurvivorFieldChange {
  field: PersonField;
  before: PersonFieldValue;
  after: PersonFieldValue;
}

/** A same-BD connection conflict: both original rows, plus the aggregated row written onto survivor's. */
export interface ConnectionConflict {
  bdId: string;
  survivorOriginal: MergeConnection;
  mergedOriginal: MergeConnection;
  aggregated: MergeConnection;
}

export interface MergeSnapshot {
  merged: MergePersonFields;
  survivorFieldChanges: readonly SurvivorFieldChange[];
  // bdIds repointed from merged onto survivor wholesale (no same-BD conflict).
  movedConnectionBdIds: readonly string[];
  connectionConflicts: readonly ConnectionConflict[];
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
  connectionConflicts: readonly ConnectionConflict[];
  referencesToRepoint: readonly MergeReferenceRow[];
  idMapRowsToRepoint: readonly MergeIdMapRow[];
  duplicateCandidatesToRepoint: readonly RepointedPair[];
  duplicateCandidatesToDrop: readonly string[];
  duplicateCandidateToMarkMerged: string | null;
  snapshot: MergeSnapshot;
}

const TRACKED_FIELDS: readonly PersonField[] = [
  "firstName",
  "lastName",
  "email",
  "emailNormalized",
  "emailStatus",
  "emailConfidence",
  "emailSource",
  "company",
  "companyKey",
  "companyCategory",
  "jobTitle",
  "roleGroup",
  "seniority",
  "industry",
  "city",
  "region",
  "country",
  "ownerBdId",
  "sourceKey",
];

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

/** Earliest of two `connected_on` free-text values; unparseable values sort last (same rule as pickOwner/collapsePlanner). */
function earliestConnectedOn(a: string | null, b: string | null): string | null {
  const pa = parseConnectedOnDate(a);
  const pb = parseConnectedOnDate(b);
  if (pa && pb) return pa.getTime() <= pb.getTime() ? a : b;
  if (pa) return a;
  if (pb) return b;
  return a ?? b;
}

function earliestDate(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a.getTime() <= b.getTime() ? a : b;
  return a ?? b;
}

function latestDate(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a.getTime() >= b.getTime() ? a : b;
  return a ?? b;
}

/** true if either side is true; null only when both sides are unknown (null). */
function orNullableBool(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true;
  if (a === null && b === null) return null;
  return false;
}

/**
 * Same-BD connection conflict (both survivor and merged are connected to the
 * same BD): aggregate onto one row instead of dropping either side's facts.
 * `connectedOn`/`firstMessageAt` take the earliest, `lastMessageAt` the
 * latest, counts sum, boolean flags OR, and `legacyContactId` keeps
 * survivor's (falling back to merged's) since it's migration traceability
 * only, not user-facing data.
 */
function aggregateConnections(survivorConn: MergeConnection, mergedConn: MergeConnection): MergeConnection {
  return {
    personId: survivorConn.personId,
    bdId: survivorConn.bdId,
    connectedOn: earliestConnectedOn(survivorConn.connectedOn, mergedConn.connectedOn),
    legacyContactId: survivorConn.legacyContactId ?? mergedConn.legacyContactId,
    messageCount: survivorConn.messageCount + mergedConn.messageCount,
    sentCount: survivorConn.sentCount + mergedConn.sentCount,
    receivedCount: survivorConn.receivedCount + mergedConn.receivedCount,
    firstMessageAt: earliestDate(survivorConn.firstMessageAt, mergedConn.firstMessageAt),
    lastMessageAt: latestDate(survivorConn.lastMessageAt, mergedConn.lastMessageAt),
    initiatedByMe: orNullableBool(survivorConn.initiatedByMe, mergedConn.initiatedByMe),
    reciprocal: survivorConn.reciprocal || mergedConn.reciprocal,
  };
}

/** Value-equality for a connection row's mutable columns (ignores personId/bdId identity). */
function connectionValuesEqual(a: MergeConnection, b: MergeConnection): boolean {
  return (
    a.connectedOn === b.connectedOn &&
    a.legacyContactId === b.legacyContactId &&
    a.messageCount === b.messageCount &&
    a.sentCount === b.sentCount &&
    a.receivedCount === b.receivedCount &&
    (a.firstMessageAt?.getTime() ?? null) === (b.firstMessageAt?.getTime() ?? null) &&
    (a.lastMessageAt?.getTime() ?? null) === (b.lastMessageAt?.getTime() ?? null) &&
    a.initiatedByMe === b.initiatedByMe &&
    a.reciprocal === b.reciprocal
  );
}

/**
 * Plans folding `merged` into `survivor` in one pass. Reversible: every
 * survivor field the merge changes is recorded as a before/after pair, every
 * same-BD connection conflict is recorded with both originals plus the
 * aggregated row, and the merged person's full row is captured so
 * `planUnmerge` can restore it exactly (it is hidden until then, so nothing
 * else can have changed it).
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

  const survivorFieldChanges: SurvivorFieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const before = survivor[field] as PersonFieldValue;
    const after = survivorUpdate[field] as PersonFieldValue;
    if (before !== after) survivorFieldChanges.push({ field, before, after });
  }

  const survivorConnectionByBdId = new Map(input.survivorConnections.map((c) => [c.bdId, c]));
  const connectionsToRepoint: MergeConnection[] = [];
  const connectionConflicts: ConnectionConflict[] = [];
  for (const c of input.mergedConnections) {
    const existing = survivorConnectionByBdId.get(c.bdId);
    if (!existing) {
      connectionsToRepoint.push({ ...c, personId: survivor.id });
    } else {
      connectionConflicts.push({
        bdId: c.bdId,
        survivorOriginal: existing,
        mergedOriginal: c,
        aggregated: aggregateConnections(existing, c),
      });
    }
  }

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
    merged,
    survivorFieldChanges,
    movedConnectionBdIds: connectionsToRepoint.map((c) => c.bdId),
    connectionConflicts,
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
    connectionConflicts,
    referencesToRepoint: input.referencesOnMerged,
    idMapRowsToRepoint: input.idMapRowsOnMerged,
    duplicateCandidatesToRepoint,
    duplicateCandidatesToDrop,
    duplicateCandidateToMarkMerged: mergedPairCandidate?.id ?? null,
    snapshot,
  };
}

/** A survivor field being reverted: `from` is the value the merge wrote, `to` is the pre-merge value being restored. */
export interface FieldRevert {
  field: PersonField;
  from: PersonFieldValue;
  to: PersonFieldValue;
}

/** A survivor field NOT reverted because its current value no longer matches what the merge wrote. */
export interface FieldKept {
  field: PersonField;
  currentValue: PersonFieldValue;
}

export interface ConnectionConflictRestore {
  bdId: string;
  kind: "reverted" | "kept_changed";
  // Set only when kind === "reverted": the original row to write back onto the survivor.
  survivorRestore: MergeConnection | null;
  // Always set: the merged person's original row, re-created either way (merged is fully restored).
  mergedRestore: MergeConnection;
}

export interface UnmergeContext {
  // The survivor's CURRENT person row (may have changed since the merge).
  currentSurvivor: MergePersonFields;
  // The survivor's CURRENT connection rows for the bdIds this merge touched
  // (moved-back or same-BD conflict bdIds) — used to detect post-merge activity.
  currentSurvivorConnections: readonly MergeConnection[];
}

export interface UnmergePlan {
  survivorFieldReverts: readonly FieldRevert[];
  survivorFieldsKept: readonly FieldKept[];
  mergedRestore: MergePersonFields;
  // bdIds to repoint from survivor back onto merged, keeping their CURRENT column values.
  movedConnectionBdIdsBack: readonly string[];
  connectionConflictRestores: readonly ConnectionConflictRestore[];
  referencesToRepointBack: readonly MergeReferenceRow[];
  idMapRowsToRepointBack: readonly MergeIdMapRow[];
  duplicateCandidatesToRestore: readonly MergeDuplicateCandidateRow[];
  mergedPairCandidateToReopen: { id: string; originalStatus: string } | null;
}

/**
 * Replays a `MergeSnapshot` in reverse (task 6.2 + fresh-review safe-unmerge
 * fix): restores the merged person's row fully (it was hidden, nothing could
 * have changed it), but only reverts a survivor field or same-BD connection
 * conflict when its CURRENT value (from `context`) still equals what the
 * merge wrote — anything changed since (a later merge, a manual edit, new
 * messages) is kept and reported instead of silently overwritten. Moved
 * connections with no conflict are always repointed back onto `merged` BY
 * VALUE (their current row, not the pre-merge snapshot), since they were
 * never touched by the merge beyond the `person_id` column.
 */
export function planUnmerge(snapshot: MergeSnapshot, context: UnmergeContext): UnmergePlan {
  const survivorFieldReverts: FieldRevert[] = [];
  const survivorFieldsKept: FieldKept[] = [];
  for (const change of snapshot.survivorFieldChanges) {
    const current = context.currentSurvivor[change.field] as PersonFieldValue;
    if (current === change.after) {
      survivorFieldReverts.push({ field: change.field, from: change.after, to: change.before });
    } else {
      survivorFieldsKept.push({ field: change.field, currentValue: current });
    }
  }

  const currentConnectionByBdId = new Map(context.currentSurvivorConnections.map((c) => [c.bdId, c]));
  const connectionConflictRestores: ConnectionConflictRestore[] = snapshot.connectionConflicts.map((conflict) => {
    const current = currentConnectionByBdId.get(conflict.bdId);
    const stillAggregated = current !== undefined && connectionValuesEqual(current, conflict.aggregated);
    return stillAggregated
      ? { bdId: conflict.bdId, kind: "reverted" as const, survivorRestore: conflict.survivorOriginal, mergedRestore: conflict.mergedOriginal }
      : { bdId: conflict.bdId, kind: "kept_changed" as const, survivorRestore: null, mergedRestore: conflict.mergedOriginal };
  });

  return {
    survivorFieldReverts,
    survivorFieldsKept,
    mergedRestore: snapshot.merged,
    movedConnectionBdIdsBack: snapshot.movedConnectionBdIds,
    connectionConflictRestores,
    referencesToRepointBack: snapshot.movedReferences,
    idMapRowsToRepointBack: snapshot.movedIdMapRows,
    duplicateCandidatesToRestore: [...snapshot.repointedDuplicateCandidates, ...snapshot.droppedDuplicateCandidates],
    mergedPairCandidateToReopen: snapshot.mergedPairCandidate,
  };
}
