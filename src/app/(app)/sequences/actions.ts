"use server";

// Roster, drafting and approval actions, mounted by the Sequence pages (go-live, PR 13). Every
// guard is enforced in src/lib/sequences/rosterQueries.ts and draftQueries.ts; these only resolve the signed-in BD.
import { getCurrentBd } from "@/lib/queries";
import { advanceReminder as advanceReminderRow, approveBulk as approveBulkRows, approveMember as approveMemberRow, cancelApproval as cancelApprovalRow, markDraftReviewed as markDraftReviewedRow } from "@/lib/sequences/approvalQueries";
import { formatOutreachSignalLabel } from "@/lib/outreach/messageSignalLabels";
import { pickGenerateMessageLabels, signalLabelsFromDict } from "@/lib/outreach/messageLabels";
import { getDictionary } from "@/lib/i18n/server";
import {
  generateMemberDraft as generateMemberDraftRow,
  memberDraftSignals,
  regenerateReminderDraft,
  regenerateDrafts,
  saveDraftEdit,
  type DraftBatchResult,
  type SaveEditResult,
} from "@/lib/sequences/draftQueries";
import { validConfirmations } from "@/lib/sequences/draftCompose";
import { recordOptOutForMember, type OptOutResult } from "@/lib/sequences/optOutQueries";
import {
  addMembersToSequence,
  createSequenceRow,
  reinstateSequenceMember,
  removeMembersFromSequence,
  updateSequenceSettingsRow,
  type AddMembersResult,
  type CreateSequenceResult,
  type ReinstateResult,
  type RemoveMembersResult,
  type UpdateSettingsResult,
} from "@/lib/sequences/rosterQueries";

// Failure reasons are for server logs and the seed script; the browser gets the same shape it always did.
type ClientDraftBatchResult = DraftBatchResult extends infer R ? (R extends { reasons: unknown } ? Omit<R, "reasons"> : R) : never;
function withoutReasons(result: DraftBatchResult): ClientDraftBatchResult {
  if (!result.ok) return result;
  const { reasons: _reasons, ...rest } = result;
  return rest;
}

export async function createSequence(input: { name: string; emailAccountId: string; dailySendCap?: number }): Promise<CreateSequenceResult> {
  const me = await getCurrentBd();
  return createSequenceRow(me.id, input);
}

export async function addMembers(sequenceId: string, personIds: string[]): Promise<AddMembersResult> {
  const me = await getCurrentBd();
  return addMembersToSequence(me.id, sequenceId, personIds);
}

export async function removeMembers(sequenceId: string, memberIds: string[], reason: string): Promise<RemoveMembersResult> {
  const me = await getCurrentBd();
  return removeMembersFromSequence(me.id, sequenceId, memberIds, reason);
}

/** "Reincorporar". */
export async function reinstateMember(memberId: string): Promise<ReinstateResult> {
  const me = await getCurrentBd();
  return reinstateSequenceMember(me.id, memberId);
}

export async function updateSequenceSettings(sequenceId: string, patch: { name?: string; dailySendCap?: number }): Promise<UpdateSettingsResult> {
  const me = await getCurrentBd();
  return updateSequenceSettingsRow(me.id, sequenceId, patch);
}

/** "Generar borrador" on one card: creates that member's missing draft only; an existing draft is never touched. */
export async function generateMemberDraft(sequenceId: string, memberId: string): Promise<ClientDraftBatchResult> {
  const me = await getCurrentBd();
  return withoutReasons(await generateMemberDraftRow(me.id, sequenceId, memberId));
}

/** "Regenerar" (single or bulk): explicit replacement, clears review and approval. */
export async function regenerateSequenceDrafts(sequenceId: string, memberIds: string[], confirmedEdits: Record<string, number> = {}): Promise<ClientDraftBatchResult> {
  const me = await getCurrentBd();
  return withoutReasons(await regenerateDrafts(me.id, sequenceId, memberIds, {}, validConfirmations(confirmedEdits)));
}

/** "Regenerar" in the reminder dialog (step 2 only): replaces that one draft, clears its review and approval. */
export async function regenerateSequenceReminder(sequenceId: string, memberId: string, confirmedEdits: Record<string, number> = {}): Promise<ClientDraftBatchResult> {
  const me = await getCurrentBd();
  return withoutReasons(await regenerateReminderDraft(me.id, sequenceId, memberId, {}, validConfirmations(confirmedEdits)));
}

/** "Guardar sin aprobar". `step` 2 saves the reminder. */
export async function saveSequenceDraft(memberId: string, input: { subject: string; body: string }, step: 1 | 2 = 1): Promise<SaveEditResult> {
  const me = await getCurrentBd();
  return saveDraftEdit(me.id, memberId, input, step);
}

/** Called when the review dialog opens ("revisado"). Never from passive listing. */
export async function markDraftReviewed(memberId: string, step: 1 | 2 = 1) {
  const me = await getCurrentBd();
  return markDraftReviewedRow(me.id, memberId, step);
}

/** "Aprobar" on one card: not gated by the review counter. */
export async function approveMember(memberId: string, step: 1 | 2 = 1) {
  const me = await getCurrentBd();
  return approveMemberRow(me.id, memberId, step);
}

/** "Aprobar y programar los M": the server re-asserts the review gate and rejects the whole request on any unreviewed member. */
export async function approveBulk(memberIds: string[], step: 1 | 2 = 1) {
  const me = await getCurrentBd();
  return approveBulkRows(me.id, memberIds, step);
}

/** "Cancelar envio". */
export async function cancelApproval(memberId: string, step: 1 | 2 = 1) {
  const me = await getCurrentBd();
  return cancelApprovalRow(me.id, memberId, step);
}

/** "Adelantar recordatorio": moves the due date only; approval and the cap still apply. */
export async function advanceReminder(memberId: string) {
  const me = await getCurrentBd();
  return advanceReminderRow(me.id, memberId);
}

/** "No contactar": suppresses the member's address and discards every live membership of it (reason opt_out). */
export async function recordOptOut(memberId: string): Promise<OptOutResult> {
  const me = await getCurrentBd();
  return recordOptOutForMember(me.id, memberId);
}

/**
 * The "Señales usadas" chips for the review dialog, already worded. Null when the member is not the signed-in BD's own
 * (an admin reading another BD's Sequence gets none: the generator input includes that BD's private connection data).
 */
export async function loadReviewSignals(memberId: string, step: 1 | 2 = 1): Promise<string[] | null> {
  const me = await getCurrentBd();
  const signals = await memberDraftSignals(me.id, memberId, step);
  if (!signals) return null;
  const labels = signalLabelsFromDict(pickGenerateMessageLabels(await getDictionary()));
  return signals.map((s) => formatOutreachSignalLabel(s, labels));
}
