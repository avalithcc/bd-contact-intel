/**
 * Auto-prospecting consumer: takes unconsumed `hiring` signals and writes ONE draft (or one recorded refusal) per signal.
 *
 * It DRAFTS ONLY. No import here reaches a send, release, Gmail or schedule path (tests/unit/autoProspectingPlan.test.ts walks them),
 * and Sequences' generation is untouched: this reuses the single-contact generator `runGenerateOutreachMessage`, one contact at a time.
 *
 * The gates are in plan.ts. Order here: switch/cap/verified/in-play (planner), then gate 2 BEFORE the model is called, then the model, then
 * one transaction that claims the signal (`consumed_at is null`) and writes the outcome, so a consumed signal is never reworked.
 * Round trips: 2 reads + (company postings + claim/insert) per drafted signal, bounded by the per-BD daily cap.
 */
import { sql } from "drizzle-orm";
import type { generateText } from "ai";
import { db } from "@/db";
import { prospectDraft, signal } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { argentinaInstantDayWindow } from "@/lib/tasks/argentinaDate";
import { getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { LEADERSHIP_ROLE_GROUPS } from "@/lib/hiring/leadership";
import { lastContactAtSql } from "@/lib/outreach/lastContact";
import { openCycleRowSql } from "@/lib/followUp/openCycle";
import { activeMemberStateSql } from "@/lib/sequences/activeMembership";
import { buildPersonMessageInput } from "@/lib/outreach/personMessageInput";
import { runGenerateOutreachMessage } from "@/lib/outreach/generateMessage";
import { DEFAULT_MESSAGE_LANGUAGE, isMessageLanguage } from "@/lib/outreach/messageLanguage";
import { signatureWillFollow } from "@/lib/signature/compose";
import type { RoleGroupKey } from "@/lib/roleGroups";
import { verifiedLeaderAtSql } from "@/lib/prospecting/producer";
import {
  candidateFromRow,
  companyFactRefusal,
  planProspectRun,
  type CandidateRawRow,
  type ProspectCandidate,
  type ProspectDecision,
  type RefusalReason,
} from "@/lib/prospecting/plan";

const SIGNAL_BATCH = 50;
const CANDIDATES_PER_SIGNAL = 5;

/** Unconsumed hiring signals (oldest first) with their leadership contacts, best role first. One statement. */
export async function readCandidates(limit = SIGNAL_BATCH): Promise<ProspectCandidate[]> {
  const rank = sql.join(LEADERSHIP_ROLE_GROUPS.map((g) => sql`${g}`), sql`, `);
  const rows = await db.execute<CandidateRawRow>(sql`
    select s.id::text as signal_id, s.company_key, s.data as signal_data,
      p.id::text as person_id, p.first_name, p.last_name, p.job_title, p.role_group, p.company, p.preferred_language, p.email_status,
      b.id::text as bd_id, b.name as bd_name, b.signature_html as bd_signature_html, b.auto_prospecting_enabled as bd_enabled,
      exists (select 1 from sequence_member sm where sm.person_id = p.id and ${activeMemberStateSql("sm")}) as in_active_sequence,
      (exists (select 1 from task t where t.person_id = p.id and t.status = 'open')
        or exists (select 1 from follow_up_queue_item where follow_up_queue_item.person_id = p.id and follow_up_queue_item.cycle_started_on is not null and ${openCycleRowSql()})
      ) as open_follow_up,
      exists (select 1 from prospect_draft pd where pd.person_id = p.id and pd.outcome = 'drafted') as already_drafted,
      ${lastContactAtSql(sql`p.id`, sql`(select max(pbc.last_message_at) from person_bd_connection pbc where pbc.person_id = p.id)`)} as last_touch_at
    from (
      select s0.* from signal s0
      where s0.source = 'hiring' and s0.consumed_at is null
        and exists (
          select 1 from person p0 join bd b0 on b0.id = p0.owner_bd_id and b0.auto_prospecting_enabled = true
          where ${verifiedLeaderAtSql("p0", "s0.company_key")}
        )
      order by s0.created_at, s0.id
      limit ${limit}
    ) s
    cross join lateral (
      select p1.* from person p1
      where ${verifiedLeaderAtSql("p1", "s.company_key")} and p1.owner_bd_id is not null
      order by array_position(array[${rank}]::text[], p1.role_group), p1.id
      limit ${CANDIDATES_PER_SIGNAL}
    ) p
    join bd b on b.id = p.owner_bd_id
    order by s.created_at, s.id, array_position(array[${rank}]::text[], p.role_group), p.id
  `);
  return Array.from(rows, candidateFromRow);
}

/** Drafts already written today (Argentina day) per BD, for the cap. */
export async function readDraftedToday(now: Date): Promise<Map<string, number>> {
  const from = argentinaInstantDayWindow(now).fromUtc.toISOString();
  const rows = await db.execute<{ bd_id: string; n: number | string }>(sql`
    select bd_id::text as bd_id, count(*)::int as n from prospect_draft
    where outcome = 'drafted' and bd_id is not null and created_at >= ${from}::timestamptz
    group by bd_id
  `);
  return new Map(Array.from(rows, (r) => [r.bd_id, Number(r.n)]));
}

type Outcome = { signalId: string; bdId: string | null; personId: string | null } & (
  | { outcome: "refused"; reason: RefusalReason }
  | { outcome: "drafted"; subject: string; body: string; language: string }
);

/** Claims the signal and writes its outcome in one transaction. False when someone already consumed it: nothing is written. */
export async function recordOutcome(o: Outcome): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(signal)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(signal.id, o.signalId), isNull(signal.consumedAt)))
      .returning({ id: signal.id });
    if (claimed.length === 0) return false;
    await tx.insert(prospectDraft).values({
      signalId: o.signalId,
      bdId: o.bdId,
      personId: o.personId,
      outcome: o.outcome,
      reason: o.outcome === "refused" ? o.reason : null,
      subject: o.outcome === "drafted" ? o.subject : null,
      body: o.outcome === "drafted" ? o.body : null,
      language: o.outcome === "drafted" ? o.language : null,
    });
    return true;
  });
}

export interface ConsumeSummary {
  drafted: number;
  refused: number;
  deferred: number;
  failed: number;
  byReason: Record<string, number>;
}

async function draftOne(c: ProspectCandidate, generate: typeof generateText | undefined): Promise<Outcome | "failed"> {
  const base = { signalId: c.signalId, bdId: c.bdId, personId: c.personId };
  const company = await getCompanyPostingsForKey(c.companyKey);
  const refusal = companyFactRefusal(company?.displayName ?? c.company, company);
  if (refusal) return { ...base, outcome: "refused", reason: refusal };

  const language = isMessageLanguage(c.preferredLanguage) ? c.preferredLanguage : DEFAULT_MESSAGE_LANGUAGE;
  const built = buildPersonMessageInput({
    person: { firstName: c.firstName, lastName: c.lastName, jobTitle: c.jobTitle, roleGroup: (c.roleGroup ?? null) as RoleGroupKey | null, industry: null, companyKey: c.companyKey, company: company?.displayName ?? c.company },
    connection: null,
    signalBodies: [],
    company,
    senderName: c.bdName.trim(),
    language,
    channel: "email",
  });
  const result = await runGenerateOutreachMessage({ ...built, signatureFollows: signatureWillFollow(c.bdSignatureHtml) }, 0, generate);
  if (result.ok && result.subject && result.body) return { ...base, outcome: "drafted", subject: result.subject, body: result.body, language };
  if (result.ok) return { ...base, outcome: "refused", reason: "invalid_model_output" };
  if (result.errorKey === "invalidModelOutput") return { ...base, outcome: "refused", reason: "invalid_model_output" };
  if (result.errorKey === "bannedVocabulary") return { ...base, outcome: "refused", reason: "banned_vocabulary" };
  return "failed"; // transient (gateway, network): leave the signal unconsumed so the next run retries it
}

/** `execute: false` plans only: no model call, no write. */
export async function consumeSignals(opts: { execute: boolean; now?: Date; generate?: typeof generateText }): Promise<ConsumeSummary> {
  const now = opts.now ?? new Date();
  const decisions: ProspectDecision[] = planProspectRun(await readCandidates(), await readDraftedToday(now), now);
  const summary: ConsumeSummary = { drafted: 0, refused: 0, deferred: 0, failed: 0, byReason: {} };
  const count = (reason: string) => (summary.byReason[reason] = (summary.byReason[reason] ?? 0) + 1);

  for (const d of decisions) {
    if (d.kind === "defer") {
      summary.deferred++;
      count(d.reason);
      continue;
    }
    if (!opts.execute) {
      d.kind === "draft" ? summary.drafted++ : summary.refused++;
      count(d.kind === "draft" ? "would_draft" : d.reason);
      continue;
    }
    const outcome = d.kind === "refuse" ? ({ signalId: d.signalId, bdId: d.bdId, personId: d.personId, outcome: "refused", reason: d.reason } as Outcome) : await draftOne(d.candidate, opts.generate);
    if (outcome === "failed") {
      summary.failed++;
      continue;
    }
    if (!(await recordOutcome(outcome))) continue;
    outcome.outcome === "drafted" ? summary.drafted++ : summary.refused++;
    if (outcome.outcome === "refused") count(outcome.reason);
  }
  return summary;
}
