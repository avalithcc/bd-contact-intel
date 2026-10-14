/**
 * View-model of the "merge with a Sequence" warning panel on /admin/duplicates (mockup fusion-con-secuencia.html).
 * Pure: turns SequenceMergeBlockedError.plan (or a fresh plan) into what the dumb component renders, as keys, never
 * copy. Every decision (blocked, who survives, which note) is made here and tested.
 */
import { SENT_STATES } from "./memberState";
import type { MergeAffected, SequenceMergePlan } from "./mergePlan";

export interface PanelPerson {
  id: string;
  name: string;
}

export type PanelStatus = "blocked" | "ready" | "repoints" | "needsConfirmation";
export type PanelAlert = "scheduledSend" | "sendHistoryCollision" | "sendCancelled" | "sameSequence" | "sentKept";
export type PanelNote =
  | { kind: "sendsAt"; at: Date | null }
  | { kind: "sentKept"; sentAt: Date | null }
  | { kind: "repointed" }
  | { kind: "kept" }
  | { kind: "handEdited" }
  | { kind: "discardReason"; reason: string }
  | { kind: "removedUnsent" }
  | { kind: "alreadyDiscarded" };

export interface PanelRow {
  /** Null for the "no memberships" row of a person who is in no Sequence. */
  memberId: string | null;
  personId: string;
  personName: string;
  sequenceName: string | null;
  state: string | null;
  role: "member" | "survives" | "discarded" | "none";
  note: PanelNote | null;
  /** Set only on approved members: the "Cancelar envio" button. */
  cancelMemberId: string | null;
}

export interface MergePanel {
  status: PanelStatus;
  alerts: PanelAlert[];
  rows: PanelRow[];
  canMerge: boolean;
  mergeLabel: "merge" | "mergeAndDiscard";
  help: "cancelHelp" | "keepHandEdited" | "keepSurvivor" | null;
  footerNote: "blockedUntilCancelled" | "blockedHistory" | "survivorChosen" | "nothingScheduled" | "survives";
}

interface Input {
  plan: SequenceMergePlan;
  survivor: PanelPerson;
  merged: PanelPerson;
  /** The BD just cancelled a scheduled send (page flag); only shown once nothing else blocks. */
  justCancelled: boolean;
}

const hasSent = (a: MergeAffected) => (SENT_STATES as readonly string[]).includes(a.state);

export function buildMergePanel({ plan, survivor, merged, justCancelled }: Input): MergePanel | null {
  if (!plan.affected.length) return null;
  const blocked = plan.blockers.length > 0;
  const historyCollision = plan.blockers.includes("send_history_collision");
  const person = (a: MergeAffected) => (a.side === "survivor" ? survivor : merged);
  const row = (a: MergeAffected, role: PanelRow["role"], note: PanelNote | null): PanelRow => ({
    memberId: a.memberId,
    personId: person(a).id,
    personName: person(a).name,
    sequenceName: a.sequenceName,
    state: a.state,
    role,
    note,
    cancelMemberId: a.scheduledSend ? a.memberId : null,
  });

  const collisions = new Map(plan.survivingMembers.map((c) => [c.sequenceId, c.keep]));
  const emitted = new Set<string>();
  const rows: PanelRow[] = [];
  let winnerHandEdited = false;
  for (const a of plan.affected) {
    const keep = collisions.get(a.sequenceId);
    if (!keep) {
      const note: PanelNote = a.scheduledSend
        ? { kind: "sendsAt", at: a.scheduledFor }
        : hasSent(a)
          ? { kind: "sentKept", sentAt: a.sentAt }
          : { kind: a.side === "merged" ? "repointed" : "kept" };
      rows.push(row(a, "member", note));
      continue;
    }
    if (emitted.has(a.sequenceId)) continue;
    emitted.add(a.sequenceId);
    const pair = plan.affected.filter((x) => x.sequenceId === a.sequenceId);
    const win = pair.find((x) => x.side === keep)!;
    const lose = pair.find((x) => x !== win)!;
    winnerHandEdited ||= win.handEdited;
    rows.push(row(win, "survives", win.handEdited ? { kind: "handEdited" } : { kind: "kept" }));
    const loseNote: PanelNote = plan.discard.includes(lose.memberId)
      ? { kind: "discardReason", reason: "merge_duplicate" }
      : plan.deleteMembers.includes(lose.memberId)
        ? { kind: "removedUnsent" }
        : { kind: "alreadyDiscarded" };
    rows.push(row(lose, "discarded", loseNote));
  }
  for (const p of [survivor, merged]) {
    if (!plan.affected.some((a) => person(a).id === p.id)) {
      rows.push({ memberId: null, personId: p.id, personName: p.name, sequenceName: null, state: null, role: "none", note: null, cancelMemberId: null });
    }
  }

  const sameSequence = plan.survivingMembers.length > 0;
  const sent = plan.affected.some(hasSent);
  const alerts: PanelAlert[] = [];
  if (plan.blockers.includes("scheduled_send")) alerts.push("scheduledSend");
  if (historyCollision) alerts.push("sendHistoryCollision");
  if (justCancelled && !blocked) alerts.push("sendCancelled");
  if (sameSequence && !historyCollision) alerts.push("sameSequence");
  if (sent && !historyCollision) alerts.push("sentKept");

  const status: PanelStatus = blocked ? "blocked" : sameSequence ? "needsConfirmation" : sent && !justCancelled ? "repoints" : "ready";
  return {
    status,
    alerts,
    rows,
    canMerge: !blocked,
    mergeLabel: sameSequence ? "mergeAndDiscard" : "merge",
    help: plan.blockers.includes("scheduled_send")
      ? "cancelHelp"
      : sameSequence && !blocked
        ? winnerHandEdited
          ? "keepHandEdited"
          : "keepSurvivor"
        : null,
    footerNote: plan.blockers.includes("scheduled_send")
      ? "blockedUntilCancelled"
      : historyCollision
        ? "blockedHistory"
        : sameSequence
          ? "survivorChosen"
          : sent
            ? "nothingScheduled"
            : "survives",
  };
}
