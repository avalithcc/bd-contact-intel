/**
 * DB layer for Sequence drafting: the ONLY file under src/lib/sequences that calls the live generator, and only
 * through buildSequenceDraftInput (tests/unit/sequencesDraftLanguageGuard.test.ts). One compliance audience per member
 * (resolveComplianceAudience) carries both the footer address and the draft language; no audience is held, never drafted.
 * Edit protection is enforced twice: eligibility is re-checked under a row lock, and the missing-drafts insert is
 * ON CONFLICT DO NOTHING, so a draft that exists (edited or not) can only be replaced by an explicit regenerate.
 * Actions pass the signed-in BD's id; nothing here trusts the client.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, personBdConnection, sequence, sequenceDraft, sequenceMember, signal } from "@/db/schema";
import { getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { getSiteUrl } from "@/lib/config/siteUrl";
import { runGenerateOutreachMessage } from "@/lib/outreach/generateMessage";
import type { RoleGroupKey } from "@/lib/roleGroups";
import { sequenceAuditRow } from "./approvalAudit";
import { parseDbTimestamp } from "@/lib/db/timestamp";
import { REGENERABLE_STATES } from "./detailFlow";
import { blocksEditedOverwrite, composeDraft, footerRemovedOnSave, runDraftBatch, type BatchResult, type EditConfirmations, type SkippedEdit } from "./draftCompose";
import { buildSequenceDraftInput, draftSignals, senderIdentity } from "@/lib/sequences/draftInput";
import type { OutreachSignal } from "@/lib/outreach/messageSignals";
import { assertTransition, type MemberState } from "./memberState";
import { resolveComplianceAudience, type ComplianceAudience } from "./complianceAudience";
import { companyCountrySql } from "./rosterQuery";
import { issueUnsubscribeToken } from "./unsubscribeQueries";
import { buildUnsubscribeUrl } from "./unsubscribeToken";
import { openPostingSql } from "@/lib/hiring/openPosting";

const STEP = 1;
const REMINDER_STEP = 2;
const MAX_SIGNALS = 10;
export const UNMAPPED_MARKET_HOLD = "unmapped_market";
const EDITABLE: readonly string[] = REGENERABLE_STATES[1];
// A reminder is drafted for a member whose step 1 went out and whose reminder has not: "sent". Releasing it moves the member on.
const REMINDER_ELIGIBLE: readonly string[] = REGENERABLE_STATES[2];

export interface DraftDeps {
  generate: typeof runGenerateOutreachMessage;
  issueToken: typeof issueUnsubscribeToken;
  siteUrl: string;
}
const liveDeps = (): DraftDeps => ({ generate: runGenerateOutreachMessage, issueToken: issueUnsubscribeToken, siteUrl: getSiteUrl() });

type Mode = "missing" | "regenerate";
type Row = Record<string, unknown>;
const rowsOf = <T>(r: unknown) => r as T[];
const sameCompany = sql`(jp.company_key = p.company_key or jp.company_key in (select ca.company_key from company_alias ca where ca.alias_key = p.company_key))`;

/**
 * The company country comes from `companyCountrySql`, the one rule the picker and the add guard also use (own company row,
 * then the canonical one, blank counting as missing). The older `... or ... in (alias) limit 1` returned an arbitrary row of
 * the two, so this path, which writes the footer, could disagree with the picker and put the wrong region's address in the body.
 */
async function loadFacts(bdId: string, memberId: string, sequenceId?: string) {
  const [r] = rowsOf<Row>(
    await db.execute(sql`
      select sm.state, sm.hold_reason, sm.sequence_id::text, p.id::text as person_id, p.email, p.first_name, p.last_name,
             p.job_title, p.role_group, p.industry, p.company_key, p.country as person_country, p.mobile_phone, p.phone, b.name as sender_name,
             ${companyCountrySql} as company_country,
             coalesce((select json_agg(distinct jp.market) from job_posting jp
                where jp.is_it = true and ${openPostingSql("jp")} and ${sameCompany}), '[]'::json) as posting_markets,
             exists (select 1 from sequence_draft d where d.sequence_member_id = sm.id and d.step = ${STEP}) as has_draft,
             exists (select 1 from sequence_draft d where d.sequence_member_id = sm.id and d.step = ${REMINDER_STEP}) as has_reminder_draft,
             (select d.edited_at from sequence_draft d where d.sequence_member_id = sm.id and d.step = ${STEP}) as draft_edited_at,
             (select d.edited_at from sequence_draft d where d.sequence_member_id = sm.id and d.step = ${REMINDER_STEP}) as reminder_edited_at
      from sequence_member sm
      join sequence s on s.id = sm.sequence_id and s.owner_bd_id = ${bdId}::uuid
      join bd b on b.id = s.owner_bd_id
      join person p on p.id = sm.person_id
      where sm.id = ${memberId}::uuid ${sequenceId ? sql`and sm.sequence_id = ${sequenceId}::uuid` : sql``}`),
  );
  if (!r) return null;
  const audience: ComplianceAudience | null = resolveComplianceAudience({
    mobilePhone: r.mobile_phone as string | null,
    phone: r.phone as string | null,
    personCountry: r.person_country as string | null,
    companyCountry: r.company_country as string | null,
    postingMarkets: r.posting_markets as string[],
  });
  return { r, audience, state: r.state as string, hasDraft: r.has_draft as boolean, hasReminderDraft: r.has_reminder_draft as boolean, draftEditedAt: r.draft_edited_at == null ? null : parseDbTimestamp(r.draft_edited_at as string | Date), reminderEditedAt: r.reminder_edited_at == null ? null : parseDbTimestamp(r.reminder_edited_at as string | Date) };
}

/** Everything the model may see, loaded as the signed-in owner (R6: counts and shared notes only, never messages). */
async function loadPromptArgs(bdId: string, r: Row) {
  const [connection] = await db
    .select({ connectedOn: personBdConnection.connectedOn, messageCount: personBdConnection.messageCount, reciprocal: personBdConnection.reciprocal, lastMessageAt: personBdConnection.lastMessageAt })
    .from(personBdConnection)
    .where(and(eq(personBdConnection.personId, r.person_id as string), eq(personBdConnection.bdId, bdId)));
  const signals = await db.select({ data: signal.data }).from(signal).where(eq(signal.personId, r.person_id as string)).orderBy(desc(signal.createdAt)).limit(MAX_SIGNALS);
  const companyKey = r.company_key as string | null;
  return {
    person: {
      firstName: r.first_name as string | null,
      lastName: r.last_name as string | null,
      jobTitle: r.job_title as string | null,
      roleGroup: (r.role_group ?? null) as RoleGroupKey | null,
      industry: r.industry as string | null,
      companyKey,
    },
    connection: connection ?? null,
    signalBodies: signals.map((s) => (s.data as { body?: string } | null)?.body?.trim()).filter((b): b is string => Boolean(b)),
    company: companyKey ? await getCompanyPostingsForKey(companyKey) : null,
  };
}

/**
 * Generates (or regenerates) one member's step 1 draft, or its step 2 reminder when `step` is REMINDER_STEP. Throws on a
 * generator failure so the batch records it. A reminder needs a step 1 draft and a "sent" member and never changes the
 * member's state: same language, footer, fresh unsubscribe token and edit protection as step 1.
 */
/** `skippedEdited` collects the members left alone because their draft is hand-edited and the caller did not confirm THAT text. */
type EditGuard = { confirmed: EditConfirmations; skippedEdited: SkippedEdit[] };

async function draftMember(bdId: string, sequenceId: string, memberId: string, mode: Mode, deps: DraftDeps, held: string[], step = STEP, guard: EditGuard = { confirmed: {}, skippedEdited: [] }) {
  const reminder = step === REMINDER_STEP;
  const editable = reminder ? REMINDER_ELIGIBLE : EDITABLE;
  const facts = await loadFacts(bdId, memberId, sequenceId);
  if (!facts || !editable.includes(facts.state)) return "skipped";
  if (reminder ? !facts.hasDraft || (mode === "missing" && facts.hasReminderDraft) : mode === "missing" && (facts.state !== "drafted" || facts.hasDraft)) return "skipped";
  const { r, audience } = facts;
  // Cheap early exit so a refused overwrite does not spend a model call. The authoritative check is inside the transaction below.
  const seenEditedAt = reminder ? facts.reminderEditedAt : facts.draftEditedAt;
  if (blocksEditedOverwrite(mode, guard.confirmed[memberId] ?? null, seenEditedAt)) {
    guard.skippedEdited.push({ memberId, editedAt: seenEditedAt!.getTime() });
    return "skipped";
  }

  const input = audience && buildSequenceDraftInput({ ...(await loadPromptArgs(bdId, r)), ...senderIdentity((r.sender_name as string) ?? "", audience.language) }, audience, reminder ? "reminder" : "first");
  if (!audience || !input) {
    // No audience (no location signal, or an embargoed jurisdiction): hold, do not draft. The reason is a code; the UI words it.
    await db.update(sequenceMember).set({ holdReason: UNMAPPED_MARKET_HOLD, holdAt: new Date() }).where(and(eq(sequenceMember.id, memberId), sql`${sequenceMember.holdReason} is distinct from ${UNMAPPED_MARKET_HOLD}`));
    held.push(memberId);
    return "skipped";
  }

  const generated = await deps.generate(input, 0);
  if (!generated.ok || !generated.subject || !generated.body) throw new Error(`generation failed: ${generated.ok ? "empty output" : generated.errorKey}`);
  const token = await deps.issueToken({ sequenceMemberId: memberId, email: r.email as string });
  const draft = composeDraft({ subject: generated.subject, body: generated.body }, audience.address, buildUnsubscribeUrl(deps.siteUrl, token));
  if (!draft) throw new Error("no footer for an address that has an audience");

  return db.transaction(async (tx) => {
    const [m] = await tx.select({ state: sequenceMember.state }).from(sequenceMember).where(eq(sequenceMember.id, memberId)).for("update");
    if (!m || !editable.includes(m.state) || (!reminder && mode === "missing" && m.state !== "drafted")) return "skipped";
    // saveDraftEdit locks this same member row, so an edit saved after the early check above is seen here.
    const [current] = await tx.select({ editedAt: sequenceDraft.editedAt }).from(sequenceDraft).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, step)));
    if (blocksEditedOverwrite(mode, guard.confirmed[memberId] ?? null, current?.editedAt ?? null)) {
      guard.skippedEdited.push({ memberId, editedAt: current!.editedAt!.getTime() });
      return "skipped";
    }
    const values = { sequenceMemberId: memberId, step, ...draft };
    if (mode === "missing") {
      if (!(await tx.insert(sequenceDraft).values(values).onConflictDoNothing().returning({ id: sequenceDraft.id })).length) return "skipped";
    } else {
      await tx.insert(sequenceDraft).values(values).onConflictDoUpdate({
        target: [sequenceDraft.sequenceMemberId, sequenceDraft.step],
        set: { ...draft, generatedAt: new Date(), editedAt: null, editedByBdId: null, reviewedAt: null, reviewedByBdId: null, approvedAt: null, approvedByBdId: null, scheduledFor: null },
      });
      await tx.insert(auditLog).values(sequenceAuditRow("regenerate", { actorBdId: bdId, personId: r.person_id as string, memberId, sequenceId, step }));
    }
    if (reminder) return "generated";
    if (m.state === "approved") assertTransition("approved", "drafted", "regenerate");
    const clearHold = (col: typeof sequenceMember.holdReason | typeof sequenceMember.holdAt) =>
      sql`case when ${sequenceMember.holdReason} = ${UNMAPPED_MARKET_HOLD} then null else ${col} end`;
    await tx.update(sequenceMember).set({ state: "drafted" as MemberState, holdReason: clearHold(sequenceMember.holdReason), holdAt: clearHold(sequenceMember.holdAt) }).where(eq(sequenceMember.id, memberId));
    return "generated";
  });
}

/**
 * The "Señales usadas" chips of the review dialog: derived from the SAME input the generator gets (buildSequenceDraftInput
 * over loadPromptArgs), never from model output and never from the card's own facts, so the chips describe what the
 * model was actually shown. Owner-only (loadFacts joins the Sequence on the owner): null for anyone else, [] when the
 * contact has no audience (a member that can have no draft). Read-only, no generator call.
 */
export async function memberDraftSignals(bdId: string, memberId: string, step: 1 | 2 = STEP): Promise<OutreachSignal[] | null> {
  const facts = await loadFacts(bdId, memberId);
  if (!facts) return null;
  if (!facts.audience) return [];
  const input = buildSequenceDraftInput({ ...(await loadPromptArgs(bdId, facts.r)), ...senderIdentity((facts.r.sender_name as string) ?? "", facts.audience.language) }, facts.audience, step === REMINDER_STEP ? "reminder" : "first");
  return input ? draftSignals(input) : [];
}

/** `skippedEdited`: members left untouched because their draft is hand-edited and the caller did not opt in; also listed in `skipped`. */
export type DraftBatchResult = ({ ok: true; held: string[]; skippedEdited: SkippedEdit[] } & BatchResult) | { ok: false; error: "not_found" };

async function runForOwner(bdId: string, sequenceId: string, mode: Mode, memberIds: readonly string[] | null, overrides: Partial<DraftDeps>, step = STEP, confirmed: EditConfirmations = {}): Promise<DraftBatchResult> {
  const [owned] = await db.select({ id: sequence.id }).from(sequence).where(and(eq(sequence.id, sequenceId), eq(sequence.ownerBdId, bdId)));
  if (!owned) return { ok: false, error: "not_found" };
  const ids = memberIds ?? (await db
    .select({ id: sequenceMember.id })
    .from(sequenceMember)
    .where(and(eq(sequenceMember.sequenceId, sequenceId), eq(sequenceMember.state, "drafted"), sql`not exists (select 1 from sequence_draft d where d.sequence_member_id = ${sequenceMember.id} and d.step = ${STEP})`))
    .orderBy(sequenceMember.createdAt)).map((m) => m.id);
  const deps = { ...liveDeps(), ...overrides };
  const held: string[] = [];
  const skippedEdited: SkippedEdit[] = [];
  const result = await runDraftBatch([...new Set(ids)], (id) => draftMember(bdId, sequenceId, id, mode, deps, held, step, { confirmed, skippedEdited }) as Promise<"generated" | "skipped">);
  return { ok: true, held, skippedEdited, ...result };
}

/** "Generar borradores faltantes": only members with no draft at all; an existing draft, edited or not, is never touched. */
export const generateMissingDrafts = (bdId: string, sequenceId: string, deps: Partial<DraftDeps> = {}) =>
  runForOwner(bdId, sequenceId, "missing", null, deps);

/**
 * "Generar borrador" on ONE card: the same "missing" run restricted to that member, so it can only create a draft that does
 * not exist and never touches any other member or an existing (edited or not) draft.
 */
export const generateMemberDraft = (bdId: string, sequenceId: string, memberId: string, deps: Partial<DraftDeps> = {}) =>
  runForOwner(bdId, sequenceId, "missing", [memberId], deps);

/**
 * "Regenerar" (one or many): replaces the draft and clears review and approval. A hand-edited draft is replaced only for
 * the exact text listed in `confirmed`; otherwise (or when it was edited again after that) it is left alone and reported in
 * `skippedEdited` with the instant of the text found.
 */
export const regenerateDrafts = (bdId: string, sequenceId: string, memberIds: readonly string[], deps: Partial<DraftDeps> = {}, confirmed: EditConfirmations = {}) =>
  runForOwner(bdId, sequenceId, "regenerate", memberIds, deps, STEP, confirmed);

/** "Regenerar" in the reminder dialog: replaces the step 2 draft of ONE member, clears its review and approval. Owner-checked. */
export const regenerateReminderDraft = (bdId: string, sequenceId: string, memberId: string, deps: Partial<DraftDeps> = {}, confirmed: EditConfirmations = {}) =>
  runForOwner(bdId, sequenceId, "regenerate", [memberId], deps, REMINDER_STEP, confirmed);

/**
 * The step 2 reminder for one member, called by the release runner right after a step 1 send. "missing" never touches an
 * existing reminder (edited or not); "regenerate" replaces it and clears its review and approval. Ownership is checked
 * by loadFacts (the sequence must belong to bdId). Throws on a generator failure.
 */
export const generateReminderDraft = (bdId: string, sequenceId: string, memberId: string, deps: Partial<DraftDeps> = {}, mode: Mode = "missing", confirmed: EditConfirmations = {}) =>
  draftMember(bdId, sequenceId, memberId, mode, { ...liveDeps(), ...deps }, [], REMINDER_STEP, { confirmed, skippedEdited: [] }) as Promise<"generated" | "skipped">;

export type SaveEditResult = { ok: true; footerWarning: boolean } | { ok: false; error: "empty" | "not_found" | "not_editable" };

/**
 * "Guardar sin aprobar": persists the BD's text, marks it BD-owned, withdraws review and approval. Never approves.
 * `step` 2 edits the reminder of a `sent` member: it never moves the member (an approval of step 1 implies nothing about
 * it), and only a member whose reminder has not been released can be edited.
 */
export async function saveDraftEdit(bdId: string, memberId: string, input: { subject: string; body: string }, step: 1 | 2 = STEP): Promise<SaveEditResult> {
  const subject = input.subject?.trim();
  if (!subject || !input.body?.trim()) return { ok: false, error: "empty" };
  const facts = await loadFacts(bdId, memberId);
  if (!facts || !(step === REMINDER_STEP ? facts.hasReminderDraft : facts.hasDraft)) return { ok: false, error: "not_found" };
  const editable = step === REMINDER_STEP ? REMINDER_ELIGIBLE : EDITABLE;
  if (!editable.includes(facts.state)) return { ok: false, error: "not_editable" };
  const saved = await db.transaction(async (tx) => {
    const [m] = await tx.select({ state: sequenceMember.state }).from(sequenceMember).where(eq(sequenceMember.id, memberId)).for("update");
    if (!m || !editable.includes(m.state)) return false;
    await tx.update(sequenceDraft).set({ subject, body: input.body, editedAt: new Date(), editedByBdId: bdId, reviewedAt: null, reviewedByBdId: null, approvedAt: null, approvedByBdId: null, scheduledFor: null }).where(and(eq(sequenceDraft.sequenceMemberId, memberId), eq(sequenceDraft.step, step)));
    if (step === STEP && m.state === "approved") {
      assertTransition("approved", "drafted", "edit");
      await tx.update(sequenceMember).set({ state: "drafted" }).where(eq(sequenceMember.id, memberId));
    }
    return true;
  });
  return saved ? { ok: true, footerWarning: facts.audience ? footerRemovedOnSave(input.body, facts.audience.address) : false } : { ok: false, error: "not_editable" };
}
