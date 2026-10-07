/**
 * Thin DB glue for company absorption proposals (decisions live in absorption.ts). Not unit-tested directly
 * (imports `db`). Any BD may propose, so there is no admin gate here; resolving a proposal is the owner's.
 * Round trips: a proposal costs one facts query plus one insert; the owner's read is one query for a whole page.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { companyAbsorptionProposal } from "@/db/schema";
import {
  checkProposalInput,
  decideProposal,
  toOpenProposalView,
  type InputRefusal,
  type OpenProposalRow,
  type OpenProposalView,
  type ProposalFacts,
  type ProposalRefusal,
} from "@/lib/companies/absorption";

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

/**
 * The owner's read: open proposals, oldest first, with what a human needs to judge each (both companies' names,
 * stage, domain and live contact counts, who proposed it, when, the note). ONE query: the page is a CTE with its
 * own LIMIT, so the correlated contact counts run exactly once per returned row. Proposals whose absorbed company
 * is gone (NULL key) are excluded, and `total` is counted over the same predicate.
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
      s.company_key as survivor_key, s.display_name as survivor_name, s.relationship_stage as survivor_stage, s.domain as survivor_domain,
      (select count(*) from person y where y.company_key = s.company_key and y.merged_into_id is null) as survivor_contacts
    from pg_page pg
    join company a on a.company_key = pg.pg_absorbed
    join company s on s.company_key = pg.pg_survivor
    join bd b on b.id = pg.pg_bd
    order by pg.pg_created, pg.pg_id`)) as unknown as OpenProposalRow[];
  return rows.map(toOpenProposalView);
}
