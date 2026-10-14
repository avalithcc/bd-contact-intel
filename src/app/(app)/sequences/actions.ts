"use server";

// Roster actions. Imported by no page or component until the go-live PR, so none is exposed yet. Every guard is
// enforced in src/lib/sequences/rosterQueries.ts; these only resolve the signed-in BD.
import { getCurrentBd } from "@/lib/queries";
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
