/**
 * DB layer for Sequence approval. Nothing here trusts the client: ownership comes from the signed-in BD's id, the
 * review gate is re-run on rows read under a lock, and the whole request is all-or-nothing, so a forged bulk request
 * approves none. Approval binds to the draft content as it stands under the member row lock that every edit also takes;
 * an edit afterwards clears it (draftQueries).
 */
import { and, eq, exists, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, sequence, sequenceDraft, sequenceMember } from "@/db/schema";
import { sequenceAuditRow } from "./approvalAudit";
import { checkStep1Subject } from "./approvalChecks";
import { bulkApprovalGate } from "./bulkApprovalGate";
import { resolveComplianceAudience, type ComplianceAddress } from "./complianceAudience";
import { complianceRefusal, type ComplianceRefusal } from "./complianceGate";
import { COMPLIANCE_CONFIG } from "./config";
import { canTransition, type MemberState } from "./memberState";
import { LOCK_MS } from "@/lib/scheduledEmail/plan";
import { companyCountrySql, postingMarketsSql } from "./rosterQuery";
import { parseSchedule, reminderReleaseAt } from "./schedule";
import { resolveSequenceSend, type SendChoice, type SendMomentRefusal } from "./sendMoment";

// Step 1 is approved from `drafted` and moves the member. The step 2 reminder is approved on its own from `sent` and
// never moves the member: approving step 1 implies nothing about it.
const REMINDER_STEP = 2;
export type ApprovalStep = 1 | 2;
const REVIEWABLE: Record<ApprovalStep, readonly string[]> = { 1: ["drafted", "approved"], 2: ["sent"] };

export type ApprovalRejection = {
  memberId: string;
  reason: "not_found" | "not_approvable" | "no_draft" | "unreviewed" | "reply_prefix_subject" | ComplianceRefusal | SendMomentRefusal;
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The footer address each person's audience resolves to NOW (null = no audience), for all of them in ONE read. Same inputs
 * and same resolver as the draft step and the roster add, so approval, drafting and the release re-check cannot disagree.
 */
async function addressesNow(tx: Tx, personIds: readonly string[]): Promise<Map<string, ComplianceAddress | null>> {
  if (!personIds.length) return new Map();
  const ids = sql.join(personIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await tx.execute(sql`
    select p.id::text as person_id, p.country as person_country, p.mobile_phone, p.phone,
           ${companyCountrySql} as company_country, ${postingMarketsSql} as posting_markets
    from person p where p.id in (${ids})`)) as unknown as { person_id: string; person_country: string | null; mobile_phone: string | null; phone: string | null; company_country: string | null; posting_markets: string[] }[];
  return new Map(rows.map((r) => [r.person_id, resolveComplianceAudience({ mobilePhone: r.mobile_phone, phone: r.phone, personCountry: r.person_country, companyCountry: r.company_country, postingMarkets: r.posting_markets })?.address ?? null]));
}

/**
 * `when` is the BD's choice in the split button (sendMoment.ts): the cadence (today's behavior, the default), "now" or a
 * chosen Argentina time. It only decides `scheduled_for` of a STEP 1 approval; a reminder keeps its own release rule.
 */
async function approve(bdId: string, memberIds: readonly string[], gated: boolean, step: ApprovalStep, when: SendChoice = { kind: "cadence" }): Promise<ApproveResult> {
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

    // The footer was written at draft time; the audience can have moved since (country edited, posting closed, policy change).
    // Refuse here, with the BD present, instead of at release hours later. Applies to the step 2 reminder too.
    const addresses = await addressesNow(tx, members.map((m) => m.personId));
    const now = new Date();
    const moments = new Map<string, Date>();
    const rejected: ApprovalRejection[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      const d = drafts.get(id);
      const refusal = m && d ? complianceRefusal(addresses.get(m.personId) ?? null, d.body, COMPLIANCE_CONFIG) : null;
      if (!m) rejected.push({ memberId: id, reason: "not_found" });
      else if (!(step === 1 ? canTransition(m.state as MemberState, "approved", "approve") : m.state === "sent" && m.reminderDueAt !== null)) rejected.push({ memberId: id, reason: "not_approvable" });
      else if (!d) rejected.push({ memberId: id, reason: "no_draft" });
      else if (step === 1 && !checkStep1Subject(d.subject).ok) rejected.push({ memberId: id, reason: "reply_prefix_subject" });
      else if (refusal) rejected.push({ memberId: id, reason: refusal });
      else if (step === 1) {
        const moment = resolveSequenceSend(when, { now, schedule: parseSchedule(m.schedule) });
        if (moment.ok) moments.set(id, moment.scheduledFor);
        else rejected.push({ memberId: id, reason: moment.reason });
      }
    }
    if (gated) {
      const gate = bulkApprovalGate(ids.filter((id) => drafts.has(id)).map((id) => ({ id, reviewed: drafts.get(id)!.reviewedAt !== null })));
      for (const id of gate.unreviewedIds) if (!rejected.some((r) => r.memberId === id)) rejected.push({ memberId: id, reason: "unreviewed" });
    }
    if (rejected.length) return { ok: false, error: "rejected", rejected } as const;

    for (const m of members) {
      const scheduledFor = step === 1 ? moments.get(m.id)! : reminderReleaseAt(m.reminderDueAt!, now, parseSchedule(m.schedule));
      await tx.update(sequenceDraft).set({ approvedAt: now, approvedByBdId: bdId, scheduledFor }).where(eq(sequenceDraft.id, drafts.get(m.id)!.id));
      if (step === 1) await tx.update(sequenceMember).set({ state: "approved" }).where(eq(sequenceMember.id, m.id));
      await tx.insert(auditLog).values(sequenceAuditRow("approve", { actorBdId: bdId, personId: m.personId, memberId: m.id, sequenceId: m.sequenceId, step, at: now }));
    }
    return { ok: true, approved: ids } as const;
  });
}

/** "Aprobar" on one card. Not gated by the review counter: approving one visible message is deliberate. */
export const approveMember = (bdId: string, memberId: string, step: ApprovalStep = 1, when?: SendChoice) => approve(bdId, [memberId], false, step, when);

/** "Aprobar y programar los M". The server re-asserts the review gate; one unreviewed member rejects the whole request. */
export const approveBulk = (bdId: string, memberIds: readonly string[], step: ApprovalStep = 1, when?: SendChoice) => approve(bdId, memberIds, true, step, when);

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

export type RescheduleResult = { ok: true; scheduledFor: Date } | { ok: false; error: "not_found" | "not_approved" | "locked" | SendMomentRefusal };

/**
 * "Cambiar" and "Enviar ahora" on an approved card: moves the step 1 moment of a member that is still `approved`. Refused
 * ("locked") when it is due in under two minutes (the runner is about to take it); an overdue one (waiting for cap) can still
 * be moved. The runner's claim re-checks that the stored moment was not moved later since it read the candidate.
 */
export async function rescheduleApproved(bdId: string, memberId: string, when: SendChoice): Promise<RescheduleResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: sequenceMember.state, schedule: sequence.schedule, draftId: sequenceDraft.id, scheduledFor: sequenceDraft.scheduledFor })
      .from(sequenceMember)
      .innerJoin(sequence, eq(sequence.id, sequenceMember.sequenceId))
      .leftJoin(sequenceDraft, and(eq(sequenceDraft.sequenceMemberId, sequenceMember.id), eq(sequenceDraft.step, 1)))
      .where(and(eq(sequenceMember.id, memberId), eq(sequence.ownerBdId, bdId)))
      .for("update", { of: sequenceMember });
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.state !== "approved" || !row.draftId) return { ok: false, error: "not_approved" } as const;
    const now = new Date();
    const lead = row.scheduledFor ? row.scheduledFor.getTime() - now.getTime() : Infinity;
    if (lead >= 0 && lead < LOCK_MS) return { ok: false, error: "locked" } as const;
    const moment = resolveSequenceSend(when, { now, schedule: parseSchedule(row.schedule) });
    if (!moment.ok) return { ok: false, error: moment.reason } as const;
    await tx.update(sequenceDraft).set({ scheduledFor: moment.scheduledFor }).where(eq(sequenceDraft.id, row.draftId));
    return { ok: true, scheduledFor: moment.scheduledFor } as const;
  });
}
