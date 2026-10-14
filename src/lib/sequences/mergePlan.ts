/**
 * What a person merge does to Sequence memberships. Pure.
 *
 * Owner decision 2026-10-14: a merge never silently repoints and never silently refuses. It reports every affected
 * membership (sequence, state, whether a send is SCHEDULED) so the BD can act, and:
 *  - `approved` (a send is queued) blocks until the BD cancels it;
 *  - a membership with send history (sent / replied / no_reply) is NEVER deleted: sequence_send_claim cascades from
 *    sequence_member, and that claim is the only thing stopping a second send of the same step. It is repointed to
 *    the survivor, or the merge is refused;
 *  - a same-sequence collision (unique(sequence_id, person_id)) keeps ONE membership and tells the BD which.
 */
import { SENT_STATES } from "./memberState";

export interface MergeMembership {
  memberId: string;
  personId: string;
  sequenceId: string;
  sequenceName: string;
  state: string;
}

export interface MergeAffected {
  memberId: string;
  sequenceId: string;
  sequenceName: string;
  side: "survivor" | "merged";
  state: string;
  scheduledSend: boolean;
}

export type MergeBlocker = "scheduled_send" | "send_history_collision";

export interface SequenceMergePlan {
  affected: MergeAffected[];
  blockers: MergeBlocker[];
  /** Memberships moved to the survivor. */
  repoint: string[];
  /** Merged-side losers of a collision: set to `discarded` and left in place (never deleted). */
  discard: string[];
  /** Survivor-side losers (drafted or discarded only, so no claim exists to destroy). */
  deleteMembers: string[];
  survivingMembers: { sequenceId: string; sequenceName: string; keep: "survivor" | "merged" }[];
}

const hasSendHistory = (state: string) => (SENT_STATES as readonly string[]).includes(state);

export function planSequenceMerge(
  survivorId: string,
  mergedId: string,
  memberships: readonly MergeMembership[],
): SequenceMergePlan {
  const plan: SequenceMergePlan = { affected: [], blockers: [], repoint: [], discard: [], deleteMembers: [], survivingMembers: [] };
  for (const x of memberships) {
    plan.affected.push({
      memberId: x.memberId,
      sequenceId: x.sequenceId,
      sequenceName: x.sequenceName,
      side: x.personId === survivorId ? "survivor" : "merged",
      state: x.state,
      scheduledSend: x.state === "approved",
    });
  }
  if (memberships.some((x) => x.state === "approved")) plan.blockers.push("scheduled_send");

  const bySequence = new Map<string, { s?: MergeMembership; m?: MergeMembership }>();
  for (const x of memberships) {
    const slot = bySequence.get(x.sequenceId) ?? {};
    if (x.personId === survivorId) slot.s = x;
    else if (x.personId === mergedId) slot.m = x;
    bySequence.set(x.sequenceId, slot);
  }

  let refused = false;
  for (const { s, m } of bySequence.values()) {
    if (!m) continue;
    if (!s) {
      plan.repoint.push(m.memberId);
      continue;
    }
    if (hasSendHistory(s.state) || hasSendHistory(m.state)) {
      refused = true;
      continue;
    }
    const keepMerged = s.state === "discarded" && m.state !== "discarded";
    plan.survivingMembers.push({ sequenceId: s.sequenceId, sequenceName: s.sequenceName, keep: keepMerged ? "merged" : "survivor" });
    if (keepMerged) {
      plan.deleteMembers.push(s.memberId);
      plan.repoint.push(m.memberId);
    } else if (m.state !== "discarded") {
      plan.discard.push(m.memberId);
    }
  }
  if (refused) {
    plan.blockers.push("send_history_collision");
    return { ...plan, repoint: [], discard: [], deleteMembers: [], survivingMembers: [] };
  }
  return plan;
}
