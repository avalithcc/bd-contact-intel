/**
 * DB layer for Sequence approval. Nothing here trusts the client: ownership comes from the signed-in BD's id, the
 * review gate is re-run on rows read under a lock, and the whole request is all-or-nothing, so a forged bulk request
 * approves none. Approval binds to the draft content as it stands under the member row lock that every edit also takes;
 * an edit afterwards clears it (draftQueries).
 */
import { and, eq, exists, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, sequence, sequenceDraft, sequenceMember } from "@/db/schema";
import { sequenceAuditRow } from "./approvalAudit";
import { checkStep1Subject } from "./approvalChecks";
import { bulkApprovalGate } from "./bulkApprovalGate";
import { canTransition, type MemberState } from "./memberState";
import { parseSchedule, reminderReleaseAt, step1DueAt } from "./schedule";

// Step 1 is approved from `drafted` and moves the member. The step 2 reminder is approved on its own from `sent` and
// never moves the member: approving step 1 implies nothing about it.
const REMINDER_STEP = 2;
export type ApprovalStep = 1 | 2;
const REVIEWABLE: Record<ApprovalStep, readonly string[]> = { 1: ["drafted", "approved"], 2: ["sent"] };

export type ApprovalRejection = {
  memberId: string;
  reason: "not_found" | "not_approvable" | "no_draft" | "unreviewed" | "reply_prefix_subject";
};
export type ApproveResult = { ok: true; approved: string[] } | { ok: false; error: "rejected"; rejected: ApprovalRejection[] };

/** Called when the review dialog opens. Passive listing never calls it. Keeps the first review time. */
export async function markDraftReviewed(bdId: string, memberId: string, step: ApprovalStep = 1): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const [row] = await db
    .select({ id: sequenceDraft.id })
    .from(sequenceDraft)
    .innerJoin(sequenceMember, eq(sequenceMember.id, sequenceDraft.sequenceMemberId))
    .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
    .where(and(eq(sequenceMember.id, memberId), eq(sequence.ownerBdId, bdId), eq(sequenceDraft.step, step), inArray(sequenceMember.state, [...REVIEWABLE[step]])));
  if (!row) return { ok: false, error: "not_found" };
  await db.update(sequenceDraft).set({ reviewedAt: new Date(), reviewedByBdId: bdId }).where(and(eq(sequenceDraft.id, row.id), isNull(sequenceDraft.reviewedAt)));
  return { ok: true };
}

async function approve(bdId: string, memberIds: readonly string[], gated: boolean, step: ApprovalStep): Promise<ApproveResult> {
  const ids = [...new Set(memberIds)];
  if (!ids.length) return { ok: true, approved: [] };
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ id: sequenceMember.id, state: sequenceMember.state, personId: sequenceMember.personId, sequenceId: sequenceMember.sequenceId, schedule: sequence.schedule, reminderDueAt: sequenceMember.reminderDueAt })
      .from(sequenceMember)
      .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
      .where(and(inArray(sequenceMember.id, ids), eq(sequence.ownerBdId, bdId)))
      .for("update", { of: sequenceMember });
    const byId = new Map(members.map((m) => [m.id, m]));
    const drafts = new Map((await tx.select().from(sequenceDraft).where(and(inArray(sequenceDraft.sequenceMemberId, ids), eq(sequenceDraft.step, step)))).map((d) => [d.sequenceMemberId, d]));

    const rejected: ApprovalRejection[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      const d = drafts.get(id);
      if (!m) rejected.push({ memberId: id, reason: "not_found" });
      else if (!(step === 1 ? canTransition(m.state as MemberState, "approved", "approve") : m.state === "sent" && m.reminderDueAt !== null)) rejected.push({ memberId: id, reason: "not_approvable" });
      else if (!d) rejected.push({ memberId: id, reason: "no_draft" });
      else if (step === 1 && !checkStep1Subject(d.subject).ok) rejected.push({ memberId: id, reason: "reply_prefix_subject" });
    }
    if (gated) {
      const gate = bulkApprovalGate(ids.filter((id) => drafts.has(id)).map((id) => ({ id, reviewed: drafts.get(id)!.reviewedAt !== null })));
      for (const id of gate.unreviewedIds) if (!rejected.some((r) => r.memberId === id)) rejected.push({ memberId: id, reason: "unreviewed" });
    }
    if (rejected.length) return { ok: false, error: "rejected", rejected } as const;

    const now = new Date();
    for (const m of members) {
      const schedule = parseSchedule(m.schedule);
      const scheduledFor = step === 1 ? step1DueAt(now, schedule) : reminderReleaseAt(m.reminderDueAt!, now, schedule);
      await tx.update(sequenceDraft).set({ approvedAt: now, approvedByBdId: bdId, scheduledFor }).where(eq(sequenceDraft.id, drafts.get(m.id)!.id));
      if (step === 1) await tx.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, m.id));
      await tx.insert(auditLog).values(sequenceAuditRow("approve", { actorBdId: bdId, personId: m.personId, memberId: m.id, sequenceId: m.sequenceId, step, at: now }));
    }
    return { ok: true, approved: ids } as const;
  });
}

/** "Aprobar" on one card. Not gated by the review counter: approving one visible message is deliberate. */
export const approveMember = (bdId: string, memberId: string, step: ApprovalStep = 1) => approve(bdId, [memberId], false, step);

/** "Aprobar y programar los M". The server re-asserts the review gate; one unreviewed member rejects the whole request. */
export const approveBulk = (bdId: string, memberIds: readonly string[], step: ApprovalStep = 1) => approve(bdId, memberIds, true, step);

/** "Cancelar envio": approved -> drafted, approval cleared, actor recorded. A reminder (step 2) only loses its approval. */
export async function cancelApproval(bdId: string, memberId: string, step: ApprovalStep = 1): Promise<{ ok: true } | { ok: false; error: "not_found" | "not_approved" }> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ state: sequenceMember.state, personId: sequenceMember.personId, sequenceId: sequenceMember.sequenceId })
      .from(sequenceMember)
      .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
      .where(and(eq(sequenceMember.id, memberId), eq(sequence.ownerBdId, bdId)))
      .for("update", { of: sequenceMember });
    if (!m) return { ok: false, error: "not_found" } as const;
    if (step === 1 ? !canTransition(m.state as MemberState, "drafted", "cancel") : m.state !== "sent") return { ok: false, error: "not_approved" } as const;
    const cleared = await tx
      .update(sequenceDraft)
      .set({ approvedAt: null, approvedByBdId: null, scheduledFor: null })
      .where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, step), step === 2 ? isNotNull(sequenceDraft.approvedAt) : undefined))
      .returning({ id: sequenceDraft.id });
    if (step === REMINDER_STEP && !cleared.length) return { ok: false, error: "not_approved" } as const;
    if (step === 1) await tx.update(sequenceMember).set({ state: "drafted" }).where(eq(sequenceMember.id, memberId));
    await tx.insert(auditLog).values(sequenceAuditRow("cancel", { actorBdId: bdId, personId: m.personId, memberId, sequenceId: m.sequenceId, step }));
    return { ok: true } as const;
  });
}

/**
 * "Adelantar recordatorio": the reminder becomes due now. It moves only the due date; approval, the reply check and the
 * daily cap still apply at release, and an unapproved reminder has no release instant (reminderReleaseAt).
 */
export async function advanceReminder(bdId: string, memberId: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const owned = db.select({ id: sequence.id }).from(sequence).where(and(eq(sequence.id, sequenceMember.sequenceId), eq(sequence.ownerBdId, bdId)));
  const moved = await db
    .update(sequenceMember)
    .set({ reminderDueAt: new Date() })
    .where(and(eq(sequenceMember.id, memberId), eq(sequenceMember.state, "sent"), isNotNull(sequenceMember.reminderDueAt), exists(owned)))
    .returning({ id: sequenceMember.id });
  return moved.length ? { ok: true } : { ok: false, error: "not_found" };
}
