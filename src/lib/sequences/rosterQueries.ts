/**
 * Thin DB layer for the roster. Every guard decision lives in rosterGuards.ts; this file loads the facts, serializes
 * writers per Sequence (row lock) and persists. Actions pass the signed-in BD's id and nothing here trusts the client.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, emailAccount, sequence, sequenceDraft, sequenceMember } from "@/db/schema";
import { sequenceAuditRow } from "./approvalAudit";
import { validateDailySendCap, type CapRejection } from "./capValidation";
import { canTransition, type MemberState } from "./memberState";
import { DEFAULT_SCHEDULE } from "./schedule";
import { withResolvedCompanyName } from "@/lib/contacts/companyDisplayName";
import { clientStatusSql, buildRosterCandidatesQuery, companyCountrySql, postingMarketsSql } from "./rosterQuery";
import { resolveComplianceAudience } from "./complianceAudience";
import { evaluateRosterAdds, type RosterCandidate, type RosterDecision, type RosterRejection } from "./rosterGuards";
import { listSuppressionRules } from "./suppressionQueries";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Rows<T> = T[];
const rowsOf = <T>(r: unknown) => r as Rows<T>;
const idList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

export interface PickerRow {
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
  company: string | null;
  company_key: string | null;
  is_florida: boolean;
}

export async function listRosterCandidates(opts: { limit: number; search?: string }): Promise<PickerRow[]> {
  return withResolvedCompanyName(rowsOf<PickerRow & { companyCanonicalName: string | null }>(await db.execute(buildRosterCandidatesQuery(opts))));
}

/**
 * The facts the admission needs, by id. With `judgeMarket` the compliance audience is derived the way drafting and sending
 * derive it (resolveComplianceAudience) and handed to the admission as `marketMapped` (true = has an audience): an add must
 * refuse a Contact no email could carry a legal footer for, or whose jurisdiction is embargoed. Re-admission skips it (`judgeMarket` off): that member was admitted once and a no-audience hold
 * already covers it at send time.
 */
async function loadCandidates(tx: Tx, personIds: readonly string[], judgeMarket = false): Promise<RosterCandidate[]> {
  if (!personIds.length) return [];
  const rows = rowsOf<{ person_id: string; email: string | null; email_status: string; email_source: string | null; merged_into_id: string | null; company_key: string | null; client_status: string | null; person_country: string | null; mobile_phone: string | null; phone: string | null; company_country: string | null; posting_markets: string[] }>(
    await tx.execute(sql`
      select p.id::text as person_id, p.email, p.email_status, p.email_source, p.merged_into_id::text as merged_into_id,
             p.company_key, ${clientStatusSql} as client_status,
             p.country as person_country, p.mobile_phone, p.phone, ${companyCountrySql} as company_country, ${postingMarketsSql} as posting_markets
      from person p where p.id in (${idList(personIds)})`),
  );
  return rows.map((r) => ({
    personId: r.person_id,
    email: r.email,
    emailStatus: r.email_status,
    emailSource: r.email_source,
    mergedIntoId: r.merged_into_id,
    companyKey: r.company_key,
    clientStatus: r.client_status,
    ...(judgeMarket ? { marketMapped: resolveComplianceAudience({ mobilePhone: r.mobile_phone, phone: r.phone, personCountry: r.person_country, companyCountry: r.company_country, postingMarkets: r.posting_markets }) !== null } : {}),
  }));
}

async function activeCounts(tx: Tx, sequenceId: string): Promise<Map<string, number>> {
  const rows = rowsOf<{ company_key: string; n: number }>(
    await tx.execute(sql`
      select p.company_key, count(*)::int as n from sequence_member sm join person p on p.id = sm.person_id
      where sm.sequence_id = ${sequenceId}::uuid and sm.state <> 'discarded' and p.company_key is not null
      group by p.company_key`),
  );
  return new Map(rows.map((r) => [r.company_key, r.n]));
}

/** Locks the Sequence row (serializes concurrent adds so the 2-per-company cap cannot be raced) iff `bdId` owns it. */
async function lockOwnedSequence(tx: Tx, bdId: string, sequenceId: string) {
  const [row] = await tx.select().from(sequence).where(and(eq(sequence.id, sequenceId), eq(sequence.ownerBdId, bdId))).for("update");
  return row ?? null;
}

const clearApprovals = (tx: Tx, memberIds: readonly string[]) =>
  tx.update(sequenceDraft).set({ approvedAt: null, approvedByBdId: null, scheduledFor: null }).where(inArray(sequenceDraft.sequenceMemberId, [...memberIds]));

export type CreateSequenceResult =
  | { ok: true; sequenceId: string; capWarning: boolean }
  | { ok: false; error: "name_required" | "account_not_owned" | CapRejection };

export async function createSequenceRow(bdId: string, input: { name: string; emailAccountId: string; dailySendCap?: unknown }): Promise<CreateSequenceResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "name_required" };
  const cap = validateDailySendCap(input.dailySendCap);
  if (!cap.ok) return { ok: false, error: cap.reason };
  const [account] = await db.select({ id: emailAccount.id }).from(emailAccount).where(and(eq(emailAccount.id, input.emailAccountId), eq(emailAccount.bdId, bdId)));
  if (!account) return { ok: false, error: "account_not_owned" };
  const [row] = await db
    .insert(sequence)
    .values({ name, ownerBdId: bdId, emailAccountId: account.id, dailySendCap: cap.value, schedule: DEFAULT_SCHEDULE })
    .returning({ id: sequence.id });
  return { ok: true, sequenceId: row.id, capWarning: cap.warn };
}

export type AddMembersResult = ({ ok: true } & RosterDecision) | { ok: false; error: "not_found" };

export async function addMembersToSequence(bdId: string, sequenceId: string, personIds: readonly string[]): Promise<AddMembersResult> {
  const ids = [...new Set(personIds)];
  const rules = await listSuppressionRules();
  return db.transaction(async (tx) => {
    if (!(await lockOwnedSequence(tx, bdId, sequenceId))) return { ok: false, error: "not_found" } as const;
    const existing = await tx.select({ personId: sequenceMember.personId }).from(sequenceMember).where(eq(sequenceMember.sequenceId, sequenceId));
    // A requested id that matches no person is reported, never dropped: loadCandidates simply omits it.
    const loaded = new Map((await loadCandidates(tx, ids, true)).map((c) => [c.personId, c]));
    // Evaluate in request order, so which Contacts win the company limit is deterministic.
    const candidates = ids.flatMap((id) => loaded.get(id) ?? []);
    const decision = evaluateRosterAdds(candidates, {
      suppressionRules: rules,
      existingPersonIds: new Set(existing.map((e) => e.personId)),
      activeCountByCompany: await activeCounts(tx, sequenceId),
    });
    const known = new Set(candidates.map((c) => c.personId));
    for (const id of ids) if (!known.has(id)) decision.rejected.push({ personId: id, reason: "unreachable" });
    if (decision.accepted.length) {
      await tx.insert(sequenceMember).values(decision.accepted.map((personId) => ({ sequenceId, personId, state: "drafted" })));
    }
    return { ok: true, ...decision } as const;
  });
}

export type RemoveMembersResult =
  | { ok: true; removed: string[]; rejected: { memberId: string; reason: "not_found" | "not_removable" }[] }
  | { ok: false; error: "reason_required" | "not_found" };

export async function removeMembersFromSequence(bdId: string, sequenceId: string, memberIds: readonly string[], reason: string): Promise<RemoveMembersResult> {
  const why = reason?.trim();
  if (!why) return { ok: false, error: "reason_required" };
  if (!memberIds.length) return { ok: true, removed: [], rejected: [] };
  return db.transaction(async (tx) => {
    if (!(await lockOwnedSequence(tx, bdId, sequenceId))) return { ok: false, error: "not_found" } as const;
    const rows = await tx.select({ id: sequenceMember.id, state: sequenceMember.state, personId: sequenceMember.personId }).from(sequenceMember).where(and(eq(sequenceMember.sequenceId, sequenceId), inArray(sequenceMember.id, [...memberIds])));
    const byId = new Map(rows.map((r) => [r.id, r.state]));
    const removed: string[] = [];
    const rejected: { memberId: string; reason: "not_found" | "not_removable" }[] = [];
    for (const id of new Set(memberIds)) {
      const state = byId.get(id);
      if (state === undefined) rejected.push({ memberId: id, reason: "not_found" });
      else if (!canTransition(state as MemberState, "discarded", "discard")) rejected.push({ memberId: id, reason: "not_removable" });
      else removed.push(id);
    }
    if (removed.length) {
      await tx.update(sequenceMember).set({ state: "discarded", discardReason: why, discardedByBdId: bdId, discardedAt: new Date() }).where(inArray(sequenceMember.id, removed));
      await clearApprovals(tx, removed);
      const personOf = new Map(rows.map((r) => [r.id, r.personId]));
      await tx.insert(auditLog).values(removed.map((id) => sequenceAuditRow("discard", { actorBdId: bdId, personId: personOf.get(id)!, memberId: id, sequenceId })));
    }
    return { ok: true, removed, rejected } as const;
  });
}

export type ReinstateResult = { ok: true } | { ok: false; error: "not_found" | "not_discarded" | "opt_out" | RosterRejection };

export async function reinstateSequenceMember(bdId: string, memberId: string): Promise<ReinstateResult> {
  const rules = await listSuppressionRules();
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(sequenceMember).where(eq(sequenceMember.id, memberId));
    if (!m || !(await lockOwnedSequence(tx, bdId, m.sequenceId))) return { ok: false, error: "not_found" } as const;
    const [fresh] = await tx.select().from(sequenceMember).where(eq(sequenceMember.id, memberId)).for("update");
    if (fresh.state !== "discarded") return { ok: false, error: "not_discarded" } as const;
    if (!canTransition("discarded", "drafted", "readmit", { discardReason: fresh.discardReason })) return { ok: false, error: "opt_out" } as const;
    // The member itself is discarded, so it is not in activeCounts and must not trip the duplicate guard.
    const decision = evaluateRosterAdds(await loadCandidates(tx, [fresh.personId]), {
      suppressionRules: rules,
      existingPersonIds: new Set(),
      activeCountByCompany: await activeCounts(tx, fresh.sequenceId),
    });
    if (decision.rejected.length) return { ok: false, error: decision.rejected[0].reason } as const;
    await tx.update(sequenceMember).set({ state: "drafted", discardReason: null, discardedByBdId: null, discardedAt: null, holdReason: null, holdAt: null }).where(eq(sequenceMember.id, memberId));
    await clearApprovals(tx, [memberId]);
    await tx.insert(auditLog).values(sequenceAuditRow("readmit", { actorBdId: bdId, personId: fresh.personId, memberId, sequenceId: fresh.sequenceId }));
    return { ok: true } as const;
  });
}

export type UpdateSettingsResult = { ok: true; capWarning: boolean } | { ok: false; error: "not_found" | "name_required" | CapRejection };

export async function updateSequenceSettingsRow(bdId: string, sequenceId: string, patch: { name?: string; dailySendCap?: unknown }): Promise<UpdateSettingsResult> {
  const set: Partial<typeof sequence.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { ok: false, error: "name_required" };
    set.name = patch.name.trim();
  }
  let warn = false;
  if (patch.dailySendCap !== undefined) {
    const cap = validateDailySendCap(patch.dailySendCap);
    if (!cap.ok) return { ok: false, error: cap.reason };
    set.dailySendCap = cap.value;
    warn = cap.warn;
  }
  const updated = await db.update(sequence).set(set).where(and(eq(sequence.id, sequenceId), eq(sequence.ownerBdId, bdId))).returning({ id: sequence.id });
  return updated.length ? { ok: true, capWarning: warn } : { ok: false, error: "not_found" };
}
