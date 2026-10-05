/**
 * Pure merge/unmerge planner (Phase 6; design.md D6, contact-identity R7,
 * duplicate-review spec) for the unified `person` model. `planMerge` folds
 * `merged` into `survivor`: property conflicts resolve via the existing
 * `mergeProperties`/`mergeProperty` rules (contact-identity R7, same
 * functions the migration and live resolver already use), the owner
 * follows the last-worked rule (ownerRule.ts; R3 changed 2026-10-05, a manual
 * owner is sticky), and every reference (activity/task/signal/person_id_map/duplicate_candidate)
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
import { mergeProperties, mergeProperty, emailStatusRank, type EmailStatus, type PropertyLoss } from "@/lib/identity/matcher";
import { pickOwnerByLastWorked, type OwnerTouch } from "@/lib/identity/ownerRule";
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
  phone: string | null;
  mobilePhone: string | null;
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
  contactType: string | null;
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

/**
 * Bugfix (merge data-loss, same bug class as PR #243's LinkedIn conversation
 * fix): `email_message_person` is the ONLY authoritative "which persons does
 * this synced Gmail message belong to" source (see its doc comment in
 * schema.ts) and both read paths
 * (getConversationForAdmin.ts/threadMessages.ts) filter `person_id = :personId`
 * directly — no chain-resolve, unlike `conversation`. A merge that doesn't
 * repoint these rows silently hides the merged-away person's synced emails
 * forever. Fixed by repointing at merge time (not a read-time chain walk,
 * per the coordinator's brief): production has zero merged persons today, so
 * there is no historical backlog a read-time fix would need to rescue.
 */
export interface EmailMessagePersonRow {
  id: string;
  emailMessageId: string;
  personId: string;
  matchedEmail: string;
  matchConfidence: string; // 'exact' | 'inferred'
}

/** The one key builder for the survivor-rows-by-message lookup below — mergeDb.ts's query and this file's own tests must both build this key through here, never by hand. */
export function emailMessagePersonKey(row: Pick<EmailMessagePersonRow, "emailMessageId">): string {
  return row.emailMessageId;
}

/**
 * Bugfix companion (latent today — 0 of 353 open duplicate pairs have a live
 * row, per the verification query): `follow_up_queue_item` was never
 * repointed either, and both its write path (ensureTodayFollowUpQueue) and
 * read path filter `isNull(person.mergedIntoId)`, so a merged-away person's
 * queue row for that day would vanish from both identities the day this
 * bug's first live case appears.
 */
export interface FollowUpQueueItemRow {
  id: string;
  bdId: string;
  queueDate: string;
  personId: string;
  position: number;
  dueStatus: string;
  lastTouchAt: Date;
  state: string; // 'pending' | 'postponed' | 'skipped'
  snoozedUntil: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The one key builder for the survivor-rows-by-(bd,date) lookup below — mergeDb.ts's query and this file's own tests must both build this key through here, never by hand. */
export function followUpQueueItemKey(row: Pick<FollowUpQueueItemRow, "bdId" | "queueDate">): string {
  return `${row.bdId}:${row.queueDate}`;
}

/**
 * A collision on `email_message_person`'s unique (email_message_id,
 * person_id): both survivor and merged were already linked to the SAME
 * message. `winner` is what gets written onto `survivorOriginal.id` (the row
 * id that survives either way) — matchedEmail and matchConfidence always
 * move together, never a confidence label paired with the other side's
 * address.
 */
export interface EmailMessagePersonCollision {
  emailMessageId: string;
  survivorOriginal: EmailMessagePersonRow;
  mergedOriginal: EmailMessagePersonRow;
  winner: Pick<EmailMessagePersonRow, "matchedEmail" | "matchConfidence">;
}

/**
 * A collision on `follow_up_queue_item`'s unique (bd_id, queue_date,
 * person_id): both survivor and merged already had a row for the same BD on
 * the same day. `winner` is what gets written onto `survivorOriginal.id`
 * (the row id that survives either way) — only state/snoozedUntil can move;
 * position/dueStatus/lastTouchAt stay survivor's own (they describe how
 * survivor's queue selected this row, not merged's).
 */
export interface FollowUpQueueItemCollision {
  bdId: string;
  queueDate: string;
  survivorOriginal: FollowUpQueueItemRow;
  mergedOriginal: FollowUpQueueItemRow;
  winner: Pick<FollowUpQueueItemRow, "state" | "snoozedUntil">;
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
  emailMessagePersonRowsOnMerged: readonly EmailMessagePersonRow[];
  // Survivor's email_message_person rows sharing an emailMessageId with one
  // of the above — the only rows that can collide (see mergeDb.ts's query).
  survivorEmailMessagePersonRows: readonly EmailMessagePersonRow[];
  // Per-BD latest activity on either person (ownerRuleDb.ts#readOwnerTouches);
  // absent = only connection last-message times count.
  ownerTouches?: readonly OwnerTouch[];
  // Sticky manual owner markers (ownerRuleDb.ts#readManualOwnerPersonIds).
  survivorHasManualOwner?: boolean;
  mergedHasManualOwner?: boolean;
  queueItemRowsOnMerged: readonly FollowUpQueueItemRow[];
  // Survivor's follow_up_queue_item rows sharing a (bdId, queueDate) with one
  // of the above — the only rows that can collide (see mergeDb.ts's query).
  survivorQueueItemRows: readonly FollowUpQueueItemRow[];
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
  // The original merged-side row for each entry in movedConnectionBdIds, same
  // order, personId still merged.id. Needed to restore-by-value if a LATER
  // merge on the survivor later conflicts on that same bdId (see planUnmerge).
  movedConnectionOriginals: readonly MergeConnection[];
  connectionConflicts: readonly ConnectionConflict[];
  movedReferences: readonly MergeReferenceRow[];
  movedIdMapRows: readonly MergeIdMapRow[];
  repointedDuplicateCandidates: readonly MergeDuplicateCandidateRow[];
  droppedDuplicateCandidates: readonly MergeDuplicateCandidateRow[];
  mergedPairCandidate: { id: string; originalStatus: string } | null;
  propertyLosses: readonly PropertyLoss[];
  // email_message_person ids repointed onto survivor by id (no collision).
  movedEmailMessagePersonIds: readonly string[];
  emailMessagePersonCollisions: readonly EmailMessagePersonCollision[];
  // follow_up_queue_item ids repointed onto survivor by id (no collision).
  movedQueueItemIds: readonly string[];
  queueItemCollisions: readonly FollowUpQueueItemCollision[];
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
  emailMessagePersonRowsToRepoint: readonly { id: string }[];
  emailMessagePersonCollisions: readonly EmailMessagePersonCollision[];
  queueItemRowsToRepoint: readonly { id: string }[];
  queueItemCollisions: readonly FollowUpQueueItemCollision[];
  snapshot: MergeSnapshot;
}

/**
 * Every `person` column a merge carries onto the survivor. Which columns
 * belong here (and why the others do not) is pinned column by column in
 * tests/unit/mergePersonColumnCoverage.test.ts.
 */
export const MERGE_TRACKED_FIELDS: readonly PersonField[] = [
  "firstName",
  "lastName",
  "email",
  "emailNormalized",
  "emailStatus",
  "emailConfidence",
  "emailSource",
  "phone",
  "mobilePhone",
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
  "contactType",
];

function candidate(value: string | null, specificity?: number) {
  return { value, specificity };
}

/**
 * The one shared email-winner decision for a merge: given two candidates
 * that each carry an `email` + `emailStatus`, picks which one keeps its
 * email column. Ties — including neither side having an email — favor `a`.
 * Ranks by `emailStatusRank` (matcher.ts), so this can never drift from the
 * definition every other email-status comparison in the codebase already
 * uses.
 *
 * This is the single source of truth for the winner side: `mergeEmailFields`
 * below (the live merge write path used by `/admin/duplicates` and
 * `scripts/merge-duplicates.ts`) calls it directly, and
 * `duplicateTiering.ts`'s `pickEmailWinnerSide` (which drives the
 * `--tier=safe` dry-run's "which email will be discarded" line) calls it
 * too, instead of carrying its own hand-copied rule. A test proves the two
 * call sites agree BY CONSTRUCTION (both resolve through this function) —
 * see tests/unit/pickEmailWinner.test.ts.
 */
export function pickEmailWinner<T extends { email: string | null; emailStatus: EmailStatus }>(a: T, b: T): T {
  const aHas = !!a.email;
  const bHas = !!b.email;
  if (aHas && !bHas) return a;
  if (bHas && !aHas) return b;
  if (!aHas && !bHas) return a;
  return emailStatusRank(b.emailStatus) > emailStatusRank(a.emailStatus) ? b : a;
}

/** Same "email fields move together" rule as identity/resolve.ts's mergeEmailFields, adapted for two full person rows. */
function mergeEmailFields(a: MergePersonFields, b: MergePersonFields) {
  const winner = pickEmailWinner(a, b);
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

/**
 * Phones and contactType are FILL-BLANK ONLY: a non-empty survivor value always
 * stays; the merged side only fills a blank. Deliberately not `mergeProperty`,
 * whose "longer value wins" rule could replace a number a BD actually entered,
 * and for contactType (a closed two-value set) would always pick BUYER-CHAMPION
 * over INFLUENCER by length alone, which is arbitrary.
 * A differing merged-side value is returned as `loss` so the snapshot keeps it.
 */
function fillBlank(survivorValue: string | null, mergedValue: string | null): { value: string | null; loss: string | null } {
  const survivorHas = survivorValue != null && survivorValue.trim() !== "";
  const mergedHas = mergedValue != null && mergedValue.trim() !== "";
  if (survivorHas) {
    return { value: survivorValue, loss: mergedHas && mergedValue !== survivorValue ? mergedValue : null };
  }
  return { value: mergedHas ? mergedValue : survivorValue, loss: null };
}

/**
 * Owner on merge: a manual assignment is sticky (survivor's first, then
 * merged's), otherwise the BD who worked the contact last wins (see
 * ownerRule.ts; replaces R3's earliest-connector rule). Undecided keeps the
 * lead's existing owner.
 */
function pickOwner(
  survivor: MergePersonFields,
  merged: MergePersonFields,
  connections: readonly MergeConnection[],
  input: Pick<PlanMergeInput, "ownerTouches" | "survivorHasManualOwner" | "mergedHasManualOwner">,
): string | null {
  if (input.survivorHasManualOwner) return survivor.ownerBdId;
  if (input.mergedHasManualOwner) return merged.ownerBdId;
  return pickOwnerByLastWorked(connections, input.ownerTouches ?? []) ?? survivor.ownerBdId ?? merged.ownerBdId;
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

const MATCH_CONFIDENCE_RANK: Record<string, number> = { inferred: 0, exact: 1 };

/**
 * email_message_person collision rule: the unique (email_message_id,
 * person_id) constraint means repointing merged's row verbatim would
 * collide whenever BOTH persons were already linked to the SAME message.
 * Keep the survivor's row id (nothing needs to change which id this
 * message/person pair lives at) and take over merged's matchedEmail +
 * matchConfidence TOGETHER only when merged's confidence outranks
 * survivor's (exact > inferred) — matchConfidence describes matchedEmail,
 * so the two must move together or not at all, never a confidence label
 * paired with the other side's address. A tie (both exact or both
 * inferred) keeps survivor's row untouched.
 */
function planEmailMessagePersonRepoints(
  mergedRows: readonly EmailMessagePersonRow[],
  survivorRows: readonly EmailMessagePersonRow[],
): { repoints: readonly { id: string }[]; collisions: readonly EmailMessagePersonCollision[] } {
  const survivorByMessage = new Map(survivorRows.map((r) => [emailMessagePersonKey(r), r]));
  const repoints: { id: string }[] = [];
  const collisions: EmailMessagePersonCollision[] = [];
  for (const mergedRow of mergedRows) {
    const survivorRow = survivorByMessage.get(emailMessagePersonKey(mergedRow));
    if (!survivorRow) {
      repoints.push({ id: mergedRow.id });
      continue;
    }
    const mergedWins = (MATCH_CONFIDENCE_RANK[mergedRow.matchConfidence] ?? 0) > (MATCH_CONFIDENCE_RANK[survivorRow.matchConfidence] ?? 0);
    collisions.push({
      emailMessageId: mergedRow.emailMessageId,
      survivorOriginal: survivorRow,
      mergedOriginal: mergedRow,
      winner: mergedWins
        ? { matchedEmail: mergedRow.matchedEmail, matchConfidence: mergedRow.matchConfidence }
        : { matchedEmail: survivorRow.matchedEmail, matchConfidence: survivorRow.matchConfidence },
    });
  }
  return { repoints, collisions };
}

/**
 * follow_up_queue_item collision rule: the unique (bd_id, queue_date,
 * person_id) constraint means repointing merged's row verbatim would
 * collide whenever BOTH persons already had a row for the same BD on the
 * same day. Keep the survivor's row id and its own
 * position/dueStatus/lastTouchAt (those describe how the row was selected
 * into SURVIVOR's queue that day, not merged's); only state/snoozedUntil
 * can move, and only when merged's is a DECIDED state ('postponed' /
 * 'skipped') while survivor's is still 'pending' — a decision the BD
 * already made must never be silently resurrected as pending by a merge.
 * If both rows are already decided, survivor's own decision wins (arbitrary
 * but documented tie-break: the surviving identity's own choice for that
 * day).
 */
function planQueueItemRepoints(
  mergedRows: readonly FollowUpQueueItemRow[],
  survivorRows: readonly FollowUpQueueItemRow[],
): { repoints: readonly { id: string }[]; collisions: readonly FollowUpQueueItemCollision[] } {
  const survivorByKey = new Map(survivorRows.map((r) => [followUpQueueItemKey(r), r]));
  const repoints: { id: string }[] = [];
  const collisions: FollowUpQueueItemCollision[] = [];
  for (const mergedRow of mergedRows) {
    const survivorRow = survivorByKey.get(followUpQueueItemKey(mergedRow));
    if (!survivorRow) {
      repoints.push({ id: mergedRow.id });
      continue;
    }
    const mergedDecided = mergedRow.state !== "pending";
    const survivorDecided = survivorRow.state !== "pending";
    const mergedWins = mergedDecided && !survivorDecided;
    collisions.push({
      bdId: mergedRow.bdId,
      queueDate: mergedRow.queueDate,
      survivorOriginal: survivorRow,
      mergedOriginal: mergedRow,
      winner: mergedWins
        ? { state: mergedRow.state, snoozedUntil: mergedRow.snoozedUntil }
        : { state: survivorRow.state, snoozedUntil: survivorRow.snoozedUntil },
    });
  }
  return { repoints, collisions };
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
  const phoneResult = fillBlank(survivor.phone, merged.phone);
  const mobileResult = fillBlank(survivor.mobilePhone, merged.mobilePhone);
  if (phoneResult.loss) propertyLosses.push({ property: "phone", value: phoneResult.loss });
  if (mobileResult.loss) propertyLosses.push({ property: "mobilePhone", value: mobileResult.loss });
  const contactTypeResult = fillBlank(survivor.contactType, merged.contactType);
  if (contactTypeResult.loss) propertyLosses.push({ property: "contactType", value: contactTypeResult.loss });

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
    phone: phoneResult.value,
    mobilePhone: mobileResult.value,
    contactType: contactTypeResult.value,
    ownerBdId: pickOwner(survivor, merged, [...input.survivorConnections, ...input.mergedConnections], input),
  };

  const survivorFieldChanges: SurvivorFieldChange[] = [];
  for (const field of MERGE_TRACKED_FIELDS) {
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

  const movedConnectionOriginals = input.mergedConnections.filter((c) => !survivorConnectionByBdId.get(c.bdId));

  const { repoints: emailMessagePersonRowsToRepoint, collisions: emailMessagePersonCollisions } = planEmailMessagePersonRepoints(
    input.emailMessagePersonRowsOnMerged,
    input.survivorEmailMessagePersonRows,
  );
  const { repoints: queueItemRowsToRepoint, collisions: queueItemCollisions } = planQueueItemRepoints(
    input.queueItemRowsOnMerged,
    input.survivorQueueItemRows,
  );

  const snapshot: MergeSnapshot = {
    merged,
    survivorFieldChanges,
    movedConnectionBdIds: connectionsToRepoint.map((c) => c.bdId),
    movedConnectionOriginals,
    connectionConflicts,
    movedReferences: input.referencesOnMerged,
    movedIdMapRows: input.idMapRowsOnMerged,
    repointedDuplicateCandidates: repointedForSnapshot,
    droppedDuplicateCandidates: droppedForSnapshot,
    mergedPairCandidate,
    propertyLosses,
    movedEmailMessagePersonIds: emailMessagePersonRowsToRepoint.map((r) => r.id),
    emailMessagePersonCollisions,
    movedQueueItemIds: queueItemRowsToRepoint.map((r) => r.id),
    queueItemCollisions,
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
    emailMessagePersonRowsToRepoint,
    emailMessagePersonCollisions,
    queueItemRowsToRepoint,
    queueItemCollisions,
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
  // bdIds (from this merge's movedConnectionBdIds) where a LATER merge_event
  // on the same survivor recorded a same-BD conflict for that bdId — i.e. the
  // connection this merge moved cleanly was aggregated onto by a subsequent
  // merge. The mergeDb caller resolves this by querying later merge_events.
  // Default: [] (no chained conflict — normal move-back-by-value applies).
  laterConflictBdIds?: readonly string[];
  // The survivor's CURRENT email_message_person rows for the ids this
  // merge's collisions touched (keyed by row id below) — used for the same
  // safe-revert check as connection conflicts: only undo a collision write
  // if nothing has changed it since (no chain-tracking needed here, unlike
  // connections, because there is no aggregation to "belong" to a later
  // merge — an unrelated later change simply means "kept_changed").
  // Default: [].
  currentSurvivorEmailMessagePersonRows?: readonly EmailMessagePersonRow[];
  // Same idea for follow_up_queue_item collisions. Default: [].
  currentSurvivorQueueItemRows?: readonly FollowUpQueueItemRow[];
}

/** A single email_message_person collision's post-merge outcome. */
export interface EmailMessagePersonRestore {
  // Always re-inserted onto `merged` (it was deleted at merge time to resolve the unique-constraint collision).
  mergedOriginal: EmailMessagePersonRow;
  // Set only if the merge actually changed survivor's row AND nothing has
  // touched it since — the pre-merge matchedEmail/matchConfidence to write back.
  survivorRevert: { id: string; matchedEmail: string; matchConfidence: string } | null;
}

/** A single follow_up_queue_item collision's post-merge outcome. */
export interface FollowUpQueueItemRestore {
  // Always re-inserted onto `merged` (it was deleted at merge time to resolve the unique-constraint collision).
  mergedOriginal: FollowUpQueueItemRow;
  // Set only if the merge actually changed survivor's row AND nothing has
  // touched it since — the pre-merge state/snoozedUntil to write back.
  survivorRevert: { id: string; state: string; snoozedUntil: string | null } | null;
}

/** A moved (no-conflict-at-merge-time) connection whose bdId was aggregated by a LATER merge on the survivor. */
export interface MovedConnectionKeptOnSurvivor {
  bdId: string;
  // The original row this merge moved from merged, restored onto merged as-is
  // (NOT the survivor's current, now-aggregated, row).
  mergedRestore: MergeConnection;
}

export interface UnmergePlan {
  survivorFieldReverts: readonly FieldRevert[];
  survivorFieldsKept: readonly FieldKept[];
  mergedRestore: MergePersonFields;
  // bdIds to repoint from survivor back onto merged, keeping their CURRENT column values.
  movedConnectionBdIdsBack: readonly string[];
  // bdIds this merge moved that a LATER merge conflicted on: the row stays on
  // the survivor (it now belongs to that later merge's history), and merged's
  // original row is re-inserted from the snapshot instead.
  movedConnectionsKeptOnSurvivor: readonly MovedConnectionKeptOnSurvivor[];
  connectionConflictRestores: readonly ConnectionConflictRestore[];
  referencesToRepointBack: readonly MergeReferenceRow[];
  idMapRowsToRepointBack: readonly MergeIdMapRow[];
  duplicateCandidatesToRestore: readonly MergeDuplicateCandidateRow[];
  mergedPairCandidateToReopen: { id: string; originalStatus: string } | null;
  // ids to repoint personId back onto merged (no collision at merge time).
  emailMessagePersonIdsToRepointBack: readonly string[];
  emailMessagePersonRestores: readonly EmailMessagePersonRestore[];
  // ids to repoint personId back onto merged (no collision at merge time).
  queueItemIdsToRepointBack: readonly string[];
  queueItemRestores: readonly FollowUpQueueItemRestore[];
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

  const laterConflictBdIds = new Set(context.laterConflictBdIds ?? []);
  const originalByBdId = new Map(snapshot.movedConnectionOriginals.map((c) => [c.bdId, c]));
  const movedConnectionBdIdsBack: string[] = [];
  const movedConnectionsKeptOnSurvivor: MovedConnectionKeptOnSurvivor[] = [];
  for (const bdId of snapshot.movedConnectionBdIds) {
    if (laterConflictBdIds.has(bdId)) {
      const original = originalByBdId.get(bdId);
      if (original) movedConnectionsKeptOnSurvivor.push({ bdId, mergedRestore: original });
    } else {
      movedConnectionBdIdsBack.push(bdId);
    }
  }

  // Same safe-revert shape as connectionConflictRestores above: only undo the
  // collision's write onto survivor if it actually changed something AND the
  // current value still equals what THIS merge wrote — merged's original row
  // is always re-inserted either way (it was deleted to resolve the
  // collision, so there is nothing else that could have touched it).
  const currentEmailMessagePersonById = new Map((context.currentSurvivorEmailMessagePersonRows ?? []).map((r) => [r.id, r]));
  const emailMessagePersonRestores: EmailMessagePersonRestore[] = snapshot.emailMessagePersonCollisions.map((collision) => {
    const changedByMerge =
      collision.winner.matchedEmail !== collision.survivorOriginal.matchedEmail ||
      collision.winner.matchConfidence !== collision.survivorOriginal.matchConfidence;
    if (!changedByMerge) return { mergedOriginal: collision.mergedOriginal, survivorRevert: null };
    const current = currentEmailMessagePersonById.get(collision.survivorOriginal.id);
    const stillWinner =
      current !== undefined && current.matchedEmail === collision.winner.matchedEmail && current.matchConfidence === collision.winner.matchConfidence;
    return {
      mergedOriginal: collision.mergedOriginal,
      survivorRevert: stillWinner
        ? { id: collision.survivorOriginal.id, matchedEmail: collision.survivorOriginal.matchedEmail, matchConfidence: collision.survivorOriginal.matchConfidence }
        : null,
    };
  });

  const currentQueueItemById = new Map((context.currentSurvivorQueueItemRows ?? []).map((r) => [r.id, r]));
  const queueItemRestores: FollowUpQueueItemRestore[] = snapshot.queueItemCollisions.map((collision) => {
    const changedByMerge = collision.winner.state !== collision.survivorOriginal.state || collision.winner.snoozedUntil !== collision.survivorOriginal.snoozedUntil;
    if (!changedByMerge) return { mergedOriginal: collision.mergedOriginal, survivorRevert: null };
    const current = currentQueueItemById.get(collision.survivorOriginal.id);
    const stillWinner = current !== undefined && current.state === collision.winner.state && current.snoozedUntil === collision.winner.snoozedUntil;
    return {
      mergedOriginal: collision.mergedOriginal,
      survivorRevert: stillWinner
        ? { id: collision.survivorOriginal.id, state: collision.survivorOriginal.state, snoozedUntil: collision.survivorOriginal.snoozedUntil }
        : null,
    };
  });

  return {
    survivorFieldReverts,
    survivorFieldsKept,
    mergedRestore: snapshot.merged,
    movedConnectionBdIdsBack,
    movedConnectionsKeptOnSurvivor,
    connectionConflictRestores,
    referencesToRepointBack: snapshot.movedReferences,
    idMapRowsToRepointBack: snapshot.movedIdMapRows,
    duplicateCandidatesToRestore: [...snapshot.repointedDuplicateCandidates, ...snapshot.droppedDuplicateCandidates],
    mergedPairCandidateToReopen: snapshot.mergedPairCandidate,
    emailMessagePersonIdsToRepointBack: snapshot.movedEmailMessagePersonIds,
    emailMessagePersonRestores,
    queueItemIdsToRepointBack: snapshot.movedQueueItemIds,
    queueItemRestores,
  };
}

// --- parseMergeSnapshot: safe revival of merge_event.snapshot (jsonb) ---
//
// `merge_event.snapshot` is stored as jsonb: every `Date` field
// (firstMessageAt/lastMessageAt on MergeConnection) round-trips as an ISO
// string, not a Date. A raw `as unknown as MergeSnapshot` cast was previously
// used at the read site and broke `connectionValuesEqual`'s `.getTime()`
// calls (and any DB write expecting a real Date) for any snapshot recorded
// with non-null message dates. This function is the only supported way to
// turn `merge_event.snapshot` back into a `MergeSnapshot`.

function reviveNullableDate(value: unknown, path: string): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const revived = new Date(value);
    if (Number.isNaN(revived.getTime())) {
      throw new Error(`Invalid merge snapshot: unparseable date at ${path}: ${JSON.stringify(value)}`);
    }
    return revived;
  }
  throw new Error(`Invalid merge snapshot: expected a date or null at ${path}, got ${typeof value}`);
}

function parseMergeConnection(value: unknown, path: string): MergeConnection {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid merge snapshot: expected a connection object at ${path}`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.personId !== "string" || typeof row.bdId !== "string") {
    throw new Error(`Invalid merge snapshot: ${path} is missing personId/bdId`);
  }
  return {
    personId: row.personId,
    bdId: row.bdId,
    connectedOn: typeof row.connectedOn === "string" ? row.connectedOn : null,
    legacyContactId: typeof row.legacyContactId === "string" ? row.legacyContactId : null,
    messageCount: typeof row.messageCount === "number" ? row.messageCount : 0,
    sentCount: typeof row.sentCount === "number" ? row.sentCount : 0,
    receivedCount: typeof row.receivedCount === "number" ? row.receivedCount : 0,
    firstMessageAt: reviveNullableDate(row.firstMessageAt, `${path}.firstMessageAt`),
    lastMessageAt: reviveNullableDate(row.lastMessageAt, `${path}.lastMessageAt`),
    initiatedByMe: typeof row.initiatedByMe === "boolean" ? row.initiatedByMe : null,
    reciprocal: row.reciprocal === true,
  };
}

function parseConnectionConflict(value: unknown, path: string): ConnectionConflict {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid merge snapshot: expected a connection conflict object at ${path}`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.bdId !== "string") {
    throw new Error(`Invalid merge snapshot: ${path} is missing bdId`);
  }
  return {
    bdId: row.bdId,
    survivorOriginal: parseMergeConnection(row.survivorOriginal, `${path}.survivorOriginal`),
    mergedOriginal: parseMergeConnection(row.mergedOriginal, `${path}.mergedOriginal`),
    aggregated: parseMergeConnection(row.aggregated, `${path}.aggregated`),
  };
}

function reviveDate(value: unknown, path: string): Date {
  const revived = reviveNullableDate(value, path);
  if (revived === null) throw new Error(`Invalid merge snapshot: expected a date at ${path}, got null`);
  return revived;
}

function parseEmailMessagePersonRow(value: unknown, path: string): EmailMessagePersonRow {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid merge snapshot: expected an email_message_person row at ${path}`);
  }
  const row = value as Record<string, unknown>;
  for (const key of ["id", "emailMessageId", "personId", "matchedEmail", "matchConfidence"] as const) {
    if (typeof row[key] !== "string") throw new Error(`Invalid merge snapshot: ${path}.${key} must be a string`);
  }
  return {
    id: row.id as string,
    emailMessageId: row.emailMessageId as string,
    personId: row.personId as string,
    matchedEmail: row.matchedEmail as string,
    matchConfidence: row.matchConfidence as string,
  };
}

function parseEmailMessagePersonCollision(value: unknown, path: string): EmailMessagePersonCollision {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid merge snapshot: expected an email_message_person collision at ${path}`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.emailMessageId !== "string") throw new Error(`Invalid merge snapshot: ${path} is missing emailMessageId`);
  const winner = row.winner as Record<string, unknown> | undefined;
  if (!winner || typeof winner.matchedEmail !== "string" || typeof winner.matchConfidence !== "string") {
    throw new Error(`Invalid merge snapshot: ${path}.winner is invalid`);
  }
  return {
    emailMessageId: row.emailMessageId,
    survivorOriginal: parseEmailMessagePersonRow(row.survivorOriginal, `${path}.survivorOriginal`),
    mergedOriginal: parseEmailMessagePersonRow(row.mergedOriginal, `${path}.mergedOriginal`),
    winner: { matchedEmail: winner.matchedEmail, matchConfidence: winner.matchConfidence },
  };
}

function parseFollowUpQueueItemRow(value: unknown, path: string): FollowUpQueueItemRow {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid merge snapshot: expected a follow_up_queue_item row at ${path}`);
  }
  const row = value as Record<string, unknown>;
  for (const key of ["id", "bdId", "queueDate", "personId", "dueStatus", "state"] as const) {
    if (typeof row[key] !== "string") throw new Error(`Invalid merge snapshot: ${path}.${key} must be a string`);
  }
  if (typeof row.position !== "number") throw new Error(`Invalid merge snapshot: ${path}.position must be a number`);
  return {
    id: row.id as string,
    bdId: row.bdId as string,
    queueDate: row.queueDate as string,
    personId: row.personId as string,
    position: row.position,
    dueStatus: row.dueStatus as string,
    lastTouchAt: reviveDate(row.lastTouchAt, `${path}.lastTouchAt`),
    state: row.state as string,
    snoozedUntil: typeof row.snoozedUntil === "string" ? row.snoozedUntil : null,
    createdAt: reviveDate(row.createdAt, `${path}.createdAt`),
    updatedAt: reviveDate(row.updatedAt, `${path}.updatedAt`),
  };
}

function parseFollowUpQueueItemCollision(value: unknown, path: string): FollowUpQueueItemCollision {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid merge snapshot: expected a follow_up_queue_item collision at ${path}`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.bdId !== "string" || typeof row.queueDate !== "string") {
    throw new Error(`Invalid merge snapshot: ${path} is missing bdId/queueDate`);
  }
  const winner = row.winner as Record<string, unknown> | undefined;
  if (!winner || typeof winner.state !== "string") throw new Error(`Invalid merge snapshot: ${path}.winner is invalid`);
  return {
    bdId: row.bdId,
    queueDate: row.queueDate,
    survivorOriginal: parseFollowUpQueueItemRow(row.survivorOriginal, `${path}.survivorOriginal`),
    mergedOriginal: parseFollowUpQueueItemRow(row.mergedOriginal, `${path}.mergedOriginal`),
    winner: { state: winner.state, snoozedUntil: typeof winner.snoozedUntil === "string" ? winner.snoozedUntil : null },
  };
}

function asArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid merge snapshot: expected an array at ${path}`);
  return value;
}

function asStringArray(value: unknown, path: string): string[] {
  return asArray(value, path).map((v, i) => {
    if (typeof v !== "string") throw new Error(`Invalid merge snapshot: expected a string at ${path}[${i}]`);
    return v;
  });
}

/**
 * Validates and revives a `merge_event.snapshot` jsonb value into a
 * `MergeSnapshot`, reviving every Date field along the way. Throws a clear
 * `Error` (never a silent `undefined`/`NaN`) if the shape is invalid.
 */
export function parseMergeSnapshot(value: unknown): MergeSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid merge snapshot: expected an object");
  }
  const obj = value as Record<string, unknown>;
  if (!obj.merged || typeof obj.merged !== "object" || typeof (obj.merged as Record<string, unknown>).id !== "string") {
    throw new Error("Invalid merge snapshot: missing merged.id");
  }

  const mergedPairCandidateRaw = obj.mergedPairCandidate;
  let mergedPairCandidate: MergeSnapshot["mergedPairCandidate"] = null;
  if (mergedPairCandidateRaw && typeof mergedPairCandidateRaw === "object") {
    const c = mergedPairCandidateRaw as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.originalStatus !== "string") {
      throw new Error("Invalid merge snapshot: mergedPairCandidate is missing id/originalStatus");
    }
    mergedPairCandidate = { id: c.id, originalStatus: c.originalStatus };
  }

  return {
    merged: obj.merged as MergePersonFields,
    survivorFieldChanges: asArray(obj.survivorFieldChanges, "survivorFieldChanges") as SurvivorFieldChange[],
    movedConnectionBdIds: asStringArray(obj.movedConnectionBdIds, "movedConnectionBdIds"),
    movedConnectionOriginals: asArray(obj.movedConnectionOriginals, "movedConnectionOriginals").map((v, i) =>
      parseMergeConnection(v, `movedConnectionOriginals[${i}]`),
    ),
    connectionConflicts: asArray(obj.connectionConflicts, "connectionConflicts").map((v, i) =>
      parseConnectionConflict(v, `connectionConflicts[${i}]`),
    ),
    movedReferences: asArray(obj.movedReferences, "movedReferences") as MergeReferenceRow[],
    movedIdMapRows: asArray(obj.movedIdMapRows, "movedIdMapRows") as MergeIdMapRow[],
    repointedDuplicateCandidates: asArray(obj.repointedDuplicateCandidates, "repointedDuplicateCandidates") as MergeDuplicateCandidateRow[],
    droppedDuplicateCandidates: asArray(obj.droppedDuplicateCandidates, "droppedDuplicateCandidates") as MergeDuplicateCandidateRow[],
    mergedPairCandidate,
    propertyLosses: asArray(obj.propertyLosses, "propertyLosses") as PropertyLoss[],
    movedEmailMessagePersonIds: asStringArray(obj.movedEmailMessagePersonIds, "movedEmailMessagePersonIds"),
    emailMessagePersonCollisions: asArray(obj.emailMessagePersonCollisions, "emailMessagePersonCollisions").map((v, i) =>
      parseEmailMessagePersonCollision(v, `emailMessagePersonCollisions[${i}]`),
    ),
    movedQueueItemIds: asStringArray(obj.movedQueueItemIds, "movedQueueItemIds"),
    queueItemCollisions: asArray(obj.queueItemCollisions, "queueItemCollisions").map((v, i) =>
      parseFollowUpQueueItemCollision(v, `queueItemCollisions[${i}]`),
    ),
  };
}
