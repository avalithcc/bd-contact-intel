"use server";

// Roster and drafting actions. Imported by no page or component until the go-live PR, so none is exposed yet. Every
// guard is enforced in src/lib/sequences/rosterQueries.ts and draftQueries.ts; these only resolve the signed-in BD.
import { getCurrentBd } from "@/lib/queries";
import {
  generateMissingDrafts,
  regenerateDrafts,
  saveDraftEdit,
  type DraftBatchResult,
  type SaveEditResult,
} from "@/lib/sequences/draftQueries";
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

/** "Generar borradores faltantes": members with no draft only; an existing draft is never touched. */
export async function generateMissingSequenceDrafts(sequenceId: string): Promise<DraftBatchResult> {
  const me = await getCurrentBd();
  return generateMissingDrafts(me.id, sequenceId);
}

/** "Regenerar" (single or bulk): explicit replacement, clears review and approval. */
export async function regenerateSequenceDrafts(sequenceId: string, memberIds: string[]): Promise<DraftBatchResult> {
  const me = await getCurrentBd();
  return regenerateDrafts(me.id, sequenceId, memberIds);
}

/** "Guardar sin aprobar". */
export async function saveSequenceDraft(memberId: string, input: { subject: string; body: string }): Promise<SaveEditResult> {
  const me = await getCurrentBd();
  return saveDraftEdit(me.id, memberId, input);
}
