/**
 * DB layer for Sequence approval. Nothing here trusts the client: ownership comes from the signed-in BD's id, the
 * review gate is re-run on rows read under a lock, and the whole request is all-or-nothing, so a forged bulk request
 * approves none. Approval binds to the draft content as it stands under the member row lock that every edit also takes;
 * an edit afterwards clears it (draftQueries).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, sequence, sequenceDraft, sequenceMember } from "@/db/schema";
import { sequenceAuditRow } from "./approvalAudit";
import { checkStep1Subject } from "./approvalChecks";
import { bulkApprovalGate } from "./bulkApprovalGate";
import { canTransition, type MemberState } from "./memberState";
import { parseSchedule, step1DueAt } from "./schedule";

const STEP = 1;
const REVIEWABLE: readonly string[] = ["drafted", "approved"];

export type ApprovalRejection = {
  memberId: string;
  reason: "not_found" | "not_approvable" | "no_draft" | "unreviewed" | "reply_prefix_subject";
};
export type ApproveResult = { ok: true; approved: string[] } | { ok: false; error: "rejected"; rejected: ApprovalRejection[] };

/** Called when the review dialog opens. Passive listing never calls it. Keeps the first review time. */
export async function markDraftReviewed(bdId: string, memberId: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const [row] = await db
    .select({ id: sequenceDraft.id })
    .from(sequenceDraft)
    .innerJoin(sequenceMember, eq(sequenceMember.id, sequenceDraft.sequenceMemberId))
    .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
    .where(and(eq(sequenceMember.id, memberId), eq(sequence.ownerBdId, bdId), eq(sequenceDraft.step, STEP), inArray(sequenceMember.state, [...REVIEWABLE])));
  if (!row) return { ok: false, error: "not_found" };
  await db.update(sequenceDraft).set({ reviewedAt: new Date(), reviewedByBdId: bdId }).where(and(eq(sequenceDraft.id, row.id), isNull(sequenceDraft.reviewedAt)));
  return { ok: true };
}

async function approve(bdId: string, memberIds: readonly string[], gated: boolean): Promise<ApproveResult> {
  const ids = [...new Set(memberIds)];
  if (!ids.length) return { ok: true, approved: [] };
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: sequenceMember.id, state: sequenceMember.state, personId: sequenceMember.personId, sequenceId: sequenceMember.sequenceId, schedule: sequence.schedule })
      .from(sequenceMember)
      .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
      .where(and(inArray(sequenceMember.id, ids), eq(sequence.ownerBdId, bdId)))
      .for("update", { of: sequenceMember });
    const byId = new Map(members.map((m) => [m.id, m]));
    const drafts = new Map((await tx.select().from(sequenceDraft).where(and(inArray(sequenceDraft.sequenceMemberId, ids), eq(sequenceDraft.step, STEP)))).map((d) => [d.sequenceMemberId, d]));

    const rejected: ApprovalRejection[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      const d = drafts.get(id);
      if (!m) rejected.push({ memberId: id, reason: "not_found" });
      else if (!canTransition(m.state as MemberState, "approved", "approve")) rejected.push({ memberId: id, reason: "not_approvable" });
      else if (!d) rejected.push({ memberId: id, reason: "no_draft" });
      else if (!checkStep1Subject(d.subject).ok) rejected.push({ memberId: id, reason: "reply_prefix_subject" });
    }
    if (gated) {
      const gate = bulkApprovalGate(ids.filter((id) => drafts.has(id)).map((id) => ({ id, reviewed: drafts.get(id)!.reviewedAt !== null })));
      for (const id of gate.unreviewedIds) if (!rejected.some((r) => r.memberId === id)) rejected.push({ memberId: id, reason: "unreviewed" });
    }
    if (rejected.length) return { ok: false, error: "rejected", rejected } as const;

    const now = new Date();
    for (const m of members) {
      await tx.update(sequenceDraft).set({ approvedAt: now, approvedByBdId: bdId, scheduledFor: step1DueAt(now, parseSchedule(m.schedule)) }).where(eq(sequenceDraft.id, drafts.get(m.id)!.id));
      await tx.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, m.id));
      await tx.insert(auditLog).values(sequenceAuditRow("approve", { actorBdId: bdId, personId: m.personId, memberId: m.id, sequenceId: m.sequenceId, step: STEP, at: now }));
    }
    return { ok: true, approved: ids } as const;
  });
}

/** "Aprobar" on one card. Not gated by the review counter: approving one visible message is deliberate. */
export const approveMember = (bdId: string, memberId: string) => approve(bdId, [memberId], false);

/** "Aprobar y programar los M". The server re-asserts the review gate; one unreviewed member rejects the whole request. */
export const approveBulk = (bdId: string, memberIds: readonly string[]) => approve(bdId, memberIds, true);

/** "Cancelar envio": approved -> drafted, approval cleared, actor recorded. */
export async function cancelApproval(bdId: string, memberId: string): Promise<{ ok: true } | { ok: false; error: "not_found" | "not_approved" }> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ state: sequenceMember.state, personId: sequenceMember.personId, sequenceId: sequenceMember.sequenceId })
      .from(sequenceMember)
      .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
      .where(and(eq(sequenceMember.id, memberId), eq(sequence.ownerBdId, bdId)))
      .for("update", { of: sequenceMember });
    if (!m) return { ok: false, error: "not_found" } as const;
    if (!canTransition(m.state as MemberState, "drafted", "cancel")) return { ok: false, error: "not_approved" } as const;
    await tx.update(sequenceMember).set({ state: "drafted" }).where(eq(sequenceMember.id, memberId));
    await tx.update(sequenceDraft).set({ approvedAt: null, approvedByBdId: null, scheduledFor: null }).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, STEP)));
    await tx.insert(auditLog).values(sequenceAuditRow("cancel", { actorBdId: bdId, personId: m.personId, memberId, sequenceId: m.sequenceId, step: STEP }));
    return { ok: true } as const;
  });
}
