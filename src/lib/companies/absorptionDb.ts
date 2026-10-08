/**
 * Thin DB glue for company absorption proposals (decisions live in absorption.ts). Not unit-tested directly
 * (imports `db`). Any BD may propose, so there is no admin gate here; resolving a proposal is the owner's.
 * Round trips: a proposal costs one facts query plus one insert; the owner's read is one query for a whole page.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { company, companyAbsorptionProposal } from "@/db/schema";
import { companySearchCondition } from "@/lib/companies/searchCondition";
import { effectiveActivityAtSql } from "@/lib/contacts/effectiveActivityTime";
import { isUuid } from "@/lib/uuid";
import {
  CANDIDATE_MAX,
  checkProposalInput,
  decideProposal,
  decideWithdrawal,
  normalizeCandidateQuery,
  toCandidateView,
  toOpenNoticeView,
  toOpenProposalView,
  type CandidateRow,
  type CandidateView,
  type InputRefusal,
  type OpenNoticeRow,
  type OpenNoticeView,
  type OpenProposalRow,
  type OpenProposalView,
  type ProposalFacts,
  type ProposalRefusal,
  type WithdrawRefusal,
} from "@/lib/companies/absorption";
import type { ResolutionFacts } from "@/lib/companies/absorptionReview";

export type ProposeAbsorptionResult =
  | { ok: true; id: string }
  | { ok: false; reason: InputRefusal | ProposalRefusal; openProposalId?: string };

export async function proposeAbsorption(raw: {
  absorbedKey: unknown;
  survivorKey: unknown;
  proposerBdId: unknown;
  note?: unknown;
}): Promise<ProposeAbsorptionResult> {
  const checked = checkProposalInput(raw);
  if (!checked.ok) return checked;
  const p = checked.value;

  // One query for every fact the pure decision needs. Ids as text: raw SQL has no uuid type on the way out.
  const [row] = (await db.execute(sql`select
      exists(select 1 from bd where id = ${p.proposerBdId}::uuid) as proposer_ok,
      (select display_name from company where company_key = ${p.absorbedKey}) as absorbed_name,
      exists(select 1 from company where company_key = ${p.survivorKey}) as survivor_ok,
      (select id::text from company_absorption_proposal where status = 'open' and absorbed_company_key = ${p.absorbedKey}) as open_absorbed,
      (select id::text from company_absorption_proposal where status = 'open' and absorbed_company_key = ${p.survivorKey}) as open_survivor`,
  )) as unknown as { proposer_ok: boolean; absorbed_name: string | null; survivor_ok: boolean; open_absorbed: string | null; open_survivor: string | null }[];
  const facts: ProposalFacts = {
    proposerIsBd: Boolean(row?.proposer_ok),
    absorbedExists: row?.absorbed_name != null,
    survivorExists: Boolean(row?.survivor_ok),
    openForAbsorbedId: row?.open_absorbed ?? null,
    openForSurvivorId: row?.open_survivor ?? null,
  };
  const decision = decideProposal(p, facts);
  if (!decision.ok) return decision;

  // The partial unique index closes the race between two BDs proposing at once: the loser inserts nothing and
  // gets the winner's proposal back instead of an error.
  const [created] = await db
    .insert(companyAbsorptionProposal)
    .values({
      absorbedCompanyKey: decision.absorbedKey,
      absorbedDisplayName: row!.absorbed_name!,
      survivorCompanyKey: decision.survivorKey,
      proposedByBdId: p.proposerBdId,
      note: decision.note,
    })
    .onConflictDoNothing()
    .returning({ id: companyAbsorptionProposal.id });
  if (created) return { ok: true, id: created.id };

  const [winner] = (await db.execute(
    sql`select id::text as id from company_absorption_proposal where status = 'open' and absorbed_company_key = ${p.absorbedKey}`,
  )) as unknown as { id: string }[];
  return { ok: false, reason: "already_proposed", openProposalId: winner?.id };
}

export const OPEN_PROPOSALS_MAX_LIMIT = 100;

/** Latest effective activity time of a company, direct or through a contact (same rule as the /companies column). */
const lastActivityOf = (companyKey: SQL) => sql`(select greatest(
    (select max(${effectiveActivityAtSql()}) from activity where activity.company_key = ${companyKey}),
    (select max(${effectiveActivityAtSql()}) from activity join person pe on pe.id = activity.person_id where pe.company_key = ${companyKey})))`;

/**
 * The owner's read: open proposals, oldest first, with what a human needs to judge each (both companies' names,
 * stage, domain and live contact counts, who proposed it, when, the note). ONE query: the page is a CTE with its
 * own LIMIT, so the correlated contact counts run exactly once per returned row. Proposals whose absorbed company
 * is gone (NULL key) are excluded, and `total` is counted over the same predicate. The owner and last activity of each
 * side are correlated subqueries over the page's rows only (at most `limit` of them), never over the whole table.
 */
export async function listOpenAbsorptionProposals(limit = 50, offset = 0): Promise<OpenProposalView[]> {
  const take = Math.min(Math.max(Math.trunc(limit) || 0, 1), OPEN_PROPOSALS_MAX_LIMIT);
  const skip = Math.max(Math.trunc(offset) || 0, 0);
  const rows = (await db.execute(sql`
    with pg_page as (
      select p.id as pg_id, p.absorbed_company_key as pg_absorbed, p.survivor_company_key as pg_survivor,
        p.proposed_by_bd_id as pg_bd, p.note as pg_note, p.created_at as pg_created, count(*) over() as pg_total
      from company_absorption_proposal p
      where p.status = 'open' and p.absorbed_company_key is not null
      order by p.created_at, p.id
      limit ${take} offset ${skip})
    select pg.pg_id::text as id, pg.pg_note as note, pg.pg_created as created_at, pg.pg_total as total,
      b.id::text as proposer_id, b.name as proposer_name,
      a.company_key as absorbed_key, a.display_name as absorbed_name, a.relationship_stage as absorbed_stage, a.domain as absorbed_domain,
      (select count(*) from person x where x.company_key = a.company_key and x.merged_into_id is null) as absorbed_contacts,
      (select name from bd where id = a.owner_bd_id) as absorbed_owner, ${lastActivityOf(sql`a.company_key`)} as absorbed_last_activity,
      s.company_key as survivor_key, s.display_name as survivor_name, s.relationship_stage as survivor_stage, s.domain as survivor_domain,
      (select count(*) from person y where y.company_key = s.company_key and y.merged_into_id is null) as survivor_contacts,
      (select name from bd where id = s.owner_bd_id) as survivor_owner, ${lastActivityOf(sql`s.company_key`)} as survivor_last_activity
    from pg_page pg
    join company a on a.company_key = pg.pg_absorbed
    join company s on s.company_key = pg.pg_survivor
    join bd b on b.id = pg.pg_bd
    order by pg.pg_created, pg.pg_id`)) as unknown as OpenProposalRow[];
  return rows.map(toOpenProposalView);
}

/**
 * What the apply action judges, read fresh from the database: the proposal's current status and keys plus the absorbed
 * company's LIVE name (the typed confirmation is checked against it). ONE query; null when no such proposal exists.
 */
export async function readProposalForResolution(proposalId: string): Promise<ResolutionFacts | null> {
  const [row] = await db
    .select({
      status: companyAbsorptionProposal.status,
      absorbedKey: companyAbsorptionProposal.absorbedCompanyKey,
      survivorKey: companyAbsorptionProposal.survivorCompanyKey,
      absorbedName: company.displayName,
    })
    .from(companyAbsorptionProposal)
    .leftJoin(company, eq(company.companyKey, companyAbsorptionProposal.absorbedCompanyKey))
    .where(eq(companyAbsorptionProposal.id, proposalId));
  return row ?? null;
}

/**
 * The owner's "no": open -> rejected (absorption.ts#canTransition). Same guard as `withdrawAbsorption`: the WHERE on
 * `status = 'open'` is the atomic check, so two concurrent rejections (or one racing an apply) cannot both win. False
 * when it touched nothing: the proposal does not exist or is no longer open.
 */
export async function rejectAbsorption(proposalId: string, actorBdId: string): Promise<boolean> {
  if (!isUuid(proposalId) || !isUuid(actorBdId)) return false;
  const done = await db
    .update(companyAbsorptionProposal)
    .set({ status: "rejected", resolvedByBdId: actorBdId, resolvedAt: new Date() })
    .where(and(eq(companyAbsorptionProposal.id, proposalId), eq(companyAbsorptionProposal.status, "open")))
    .returning({ id: companyAbsorptionProposal.id });
  return done.length > 0;
}

export type WithdrawAbsorptionResult = { ok: true; absorbedKey: string | null } | { ok: false; reason: WithdrawRefusal };

/**
 * A BD retracts their own proposal. The row is kept (status `withdrawn`): the partial unique index only covers
 * `open`, so it blocks nothing, and the trace of a retracted mis-click is worth keeping apart from the owner's
 * `rejected`. The UPDATE's WHERE is the guard (open AND proposed by the actor), so two concurrent withdrawals or a
 * resolution racing the click cannot both win. Only when it touches nothing do we read the row, once, to say why.
 */
export async function withdrawAbsorption(proposalId: unknown, actorBdId: unknown): Promise<WithdrawAbsorptionResult> {
  if (typeof proposalId !== "string" || !isUuid(proposalId)) return { ok: false, reason: "proposal_not_found" };
  if (typeof actorBdId !== "string" || !isUuid(actorBdId)) return { ok: false, reason: "not_proposer" };
  const done = await db
    .update(companyAbsorptionProposal)
    .set({ status: "withdrawn", resolvedByBdId: actorBdId, resolvedAt: new Date() })
    .where(
      and(
        eq(companyAbsorptionProposal.id, proposalId),
        eq(companyAbsorptionProposal.status, "open"),
        eq(companyAbsorptionProposal.proposedByBdId, actorBdId),
      ),
    )
    .returning({ absorbedKey: companyAbsorptionProposal.absorbedCompanyKey });
  if (done[0]) return { ok: true, absorbedKey: done[0].absorbedKey };

  const [row] = await db
    .select({ status: companyAbsorptionProposal.status, proposedByBdId: companyAbsorptionProposal.proposedByBdId })
    .from(companyAbsorptionProposal)
    .where(eq(companyAbsorptionProposal.id, proposalId));
  const verdict = decideWithdrawal(row ?? null, actorBdId);
  // The WHERE already refused it, so a verdict of "ok" here means the row changed between the two statements.
  return verdict.ok ? { ok: false, reason: "not_open" } : verdict;
}

/** The open proposal on this company as the ABSORBED side, for the record page's notice. One indexed query (the partial unique index). */
export async function getOpenAbsorptionNotice(absorbedKey: string): Promise<OpenNoticeView | null> {
  const [row] = (await db.execute(sql`
    select p.id::text as id, p.created_at, b.id::text as proposer_id, b.name as proposer_name,
      s.company_key as survivor_key, s.display_name as survivor_name
    from company_absorption_proposal p
    join bd b on b.id = p.proposed_by_bd_id
    join company s on s.company_key = p.survivor_company_key
    where p.status = 'open' and p.absorbed_company_key = ${absorbedKey}`)) as unknown as OpenNoticeRow[];
  return row ? toOpenNoticeView(row) : null;
}

/**
 * The survivor picker's read: companies matching `q` by the same rule as the `/companies` search
 * (companySearchCondition: name, domain, alias, LinkedIn), minus the company being absorbed. ONE query, never more
 * than CANDIDATE_MAX rows; the page is a CTE with its own LIMIT so the contact count runs once per returned row,
 * not once per match. The `/companies` list read was not reused: it also counts the whole match set, joins owners
 * and orders by last activity, none of which a picker needs.
 */
export async function searchAbsorptionCandidates(rawQuery: unknown, excludeKey: string): Promise<CandidateView[]> {
  const q = normalizeCandidateQuery(rawQuery);
  const where = q ? companySearchCondition(q) : undefined;
  if (!where) return [];
  const rows = (await db.execute(sql`
    with pg_page as (
      select ${company.companyKey} as pg_key, ${company.displayName} as pg_name, ${company.relationshipStage} as pg_stage, ${company.domain} as pg_domain
      from ${company}
      where ${where} and ${company.companyKey} <> ${excludeKey}
      order by ${company.displayName}, ${company.companyKey}
      limit ${CANDIDATE_MAX})
    select pg_key as company_key, pg_name as display_name, pg_stage as relationship_stage, pg_domain as domain,
      (select count(*) from person x where x.company_key = pg_key and x.merged_into_id is null) as contacts
    from pg_page
    order by pg_name, pg_key`)) as unknown as CandidateRow[];
  return rows.map(toCandidateView);
}
