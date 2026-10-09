/**
 * DB layer for scripts/merge-companies.ts (not unit-tested: importing `@/db` throws without DATABASE_URL; every
 * branch worth testing lives in plan.ts). The dry run is a READ ONLY transaction. Execute re-reads and re-plans
 * INSIDE its transaction after locking every involved company row, so a field edited since the dry run is merged
 * as it is now, and an activity inserted meanwhile waits instead of being cascade-deleted with a dead company.
 *
 * Per-table handling of the 14 company_key tables (collisions are resolved here, never left to a constraint):
 *   - activity, board_candidate, company_property_history, contact, lead, person, signal, sync_run, task,
 *     company_alias (aliases that pointed at a dead key): no unique index involves company_key -> plain repoint.
 *   - job_posting: unique (company_key, external_id). The same ATS posting under two keys keeps ONE row (the
 *     survivor's, else the lowest id); the extra rows are deleted and their ids audited.
 *   - company_probe: PK company_key. One probe row per surviving key: the survivor's, else the lowest key.
 *   - target_company: PK. A dead target company with no surviving target gives its row (ats, config, ...) to the
 *     survivor's key first, so the postings and sync runs have a parent; dead target rows are then deleted.
 *   - company: the survivor is patched (see plan.ts), dead rows are deleted AFTER everything is repointed. The
 *     FKs from activity/task/signal/company_property_history cascade, so a check inside the transaction proves no
 *     row still references a dead key before any delete runs.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, companyPropertyHistory } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { buildRefCounts, COMPANY_KEY_TABLES, refCount, squashCompanyKey } from "./keys";
import { assertProposalMatched, matchProposalsToGroups, type OpenProposalRef, type ProposalMatches } from "./proposals";
import {
  findBlockers,
  MERGE_FIELDS,
  movedRowCounts,
  planMerge,
  refusalMessage,
  type CandidateRecord,
  type CompanyRow,
  type GroupPlan,
  type MergeContext,
  type MergeGroup,
} from "./plan";

export const MERGE_AUDIT_ACTION = "merge_companies";
const MOVED_ROW_CAP = 20_000;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];
export const list = (items: readonly string[]): SQL => sql.join(items.map((i) => sql`${i}`), sql`, `);
const pairs = (plans: readonly GroupPlan[]): SQL =>
  sql.join(plans.flatMap((p) => p.deadKeys.map((d) => sql`(${d}::text, ${p.survivorKey}::text)`)), sql`, `);

/** Tables moved by one generic UPDATE, with the column that identifies a row in the audit. */
const REPOINT: readonly (readonly [string, string])[] = [
  ["activity", "id"],
  ["board_candidate", "id"],
  ["company_alias", "alias_key"],
  ["company_probe", "company_key"],
  ["company_property_history", "id"],
  ["contact", "id"],
  ["job_posting", "id"],
  ["lead", "id"],
  ["person", "id"],
  ["signal", "id"],
  ["sync_run", "id"],
  ["task", "id"],
];

export async function countRefs(tx: Tx, keys: readonly string[]) {
  const per = COMPANY_KEY_TABLES.map((t) => sql`select ${t}::text as t, company_key as k, count(*)::int as n from ${sql.raw(t)} where company_key in (${list(keys)}) group by company_key`);
  return buildRefCounts(await run(tx, sql.join(per, sql` union all `)));
}

/** Ids a collision rule would delete: per (surviving key[, external id]) keep the survivor's row, else the lowest id. */
const duplicateIds = (plans: readonly GroupPlan[], table: string, pk: string, extra: string): SQL => sql`
  select x.d_id from (
    select j.${sql.raw(pk)}::text as d_id,
      row_number() over (partition by coalesce(m.surv, j.company_key)${sql.raw(extra)} order by (m.dead is null) desc, j.${sql.raw(pk)}) as d_rn
    from ${sql.raw(table)} j left join (values ${pairs(plans)}) as m(dead, surv) on j.company_key = m.dead
    where j.company_key in (${list(plans.flatMap((p) => [p.survivorKey, ...p.deadKeys]))})
  ) x where x.d_rn > 1`;

/**
 * Open absorption proposals touching the planned keys, classified against the owner's explicit groups. Reporting
 * and the applied marker only: a proposal never adds, removes or changes a group. Until migration 0040 is applied the
 * table does not exist, and the merge must keep working, so absence is an empty result, not an error. With `lock` the
 * rows are held for update so none can be resolved by someone else between this read and the marker below.
 */
async function readProposals(tx: Tx, groups: readonly MergeGroup[], keys: readonly string[], lock: boolean): Promise<ProposalMatches & { tableMissing: boolean }> {
  const [t] = await run<{ present: boolean }>(tx, sql`select to_regclass('public.company_absorption_proposal') is not null as present`);
  if (!t?.present) return { matched: [], divergent: [], tableMissing: true };
  const open = await run<OpenProposalRef>(tx, sql`
    select id::text as id, absorbed_company_key as "absorbedKey", survivor_company_key as "survivorKey"
    from company_absorption_proposal
    where status = 'open' and (absorbed_company_key in (${list(keys)}) or survivor_company_key in (${list(keys)}))
    order by created_at, id ${lock ? sql`for update` : sql``}`);
  return { ...matchProposalsToGroups(groups, open), tableMissing: false };
}

async function read(tx: Tx, groups: readonly MergeGroup[], lock: boolean) {
  const keys = groups.flatMap((g) => [g.survivorKey, ...g.deadKeys]);
  const rows = await run<CompanyRow>(tx, sql`
    select company_key as "companyKey", display_name as "displayName", relationship_stage as "relationshipStage",
      revenue_potential as "revenuePotential", notes, domain, industry, owner_bd_id::text as "ownerBdId", city, country,
      account_type as "accountType", client_status as "clientStatus", linkedin_url as "linkedinUrl"
    from company where company_key in (${list(keys)}) order by company_key ${lock ? sql`for update` : sql``}`);
  const companies = new Map(rows.map((r) => [r.companyKey, r]));
  const plans = planMerge(groups, companies);
  const counts = await countRefs(tx, keys);
  const targets = await run<{ company_key: string }>(tx, sql`select company_key from target_company where company_key in (${list(keys)})`);
  const aliases = await run<{ alias_key: string; company_key: string }>(tx, sql`select alias_key, company_key from company_alias where alias_key in (${list(keys)})`);
  const [fk] = await run<{ fk: boolean }>(tx, sql`select exists(select 1 from pg_constraint where conrelid = 'public.company_alias'::regclass and contype = 'f' and confrelid = 'public.target_company'::regclass) as fk`);
  const ctx: MergeContext = {
    targetKeys: new Set(targets.map((t) => t.company_key)),
    aliasTargets: new Map(aliases.map((a) => [a.alias_key, a.company_key])),
    aliasFkToTarget: Boolean(fk?.fk),
  };
  const moved = movedRowCounts(plans, counts);
  const blockers = findBlockers(plans, ctx);
  const total = Object.values(moved).reduce((a, b) => a + b, 0);
  if (total > MOVED_ROW_CAP) blockers.push(`${total} rows would move; the cap is ${MOVED_ROW_CAP}. Split the groups across runs.`);
  const targetsToCreate = plans.filter((p) => !ctx.targetKeys.has(p.survivorKey) && p.deadKeys.some((d) => ctx.targetKeys.has(d))).map((p) => p.survivorKey);
  const proposals = await readProposals(tx, groups, keys, lock);
  return { plans, counts, moved, blockers, targetsToCreate, proposals };
}

export async function dryRunMerge(groups: readonly MergeGroup[]) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const r = await read(tx, groups, false);
    const [d] = await run<{ postings: number; probes: number }>(tx, sql`select
      (select count(*)::int from (${duplicateIds(r.plans, "job_posting", "id", ", j.external_id")}) a) as postings,
      (select count(*)::int from (${duplicateIds(r.plans, "company_probe", "company_key", "")}) b) as probes`);
    return { ...r, duplicatePostings: Number(d?.postings ?? 0), duplicateProbes: Number(d?.probes ?? 0) };
  });
}

/**
 * `requireProposalId` (the review screen): throws ProposalNotOpenError inside the transaction, after the locked read
 * and before any write, unless that proposal is still open and fulfilled by the groups. Checking earlier, outside the
 * transaction, would only move the window in which someone else can reject it.
 */
export async function executeMerge(groups: readonly MergeGroup[], actorBdId: string, requireProposalId?: string) {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) => {
    const { plans, moved, blockers, targetsToCreate, proposals } = await read(tx, groups, true);
    if (requireProposalId) assertProposalMatched(proposals.matched, requireProposalId);
    if (blockers.length) throw new Error(refusalMessage(blockers));
    const deads = plans.flatMap((p) => p.deadKeys);

    await run(tx, sql`
      insert into target_company (company_key, display_name, ats, config, country_filter, active, created_at, is_startup, startup_classified_at, startup_reason)
      select distinct on (m.surv) m.surv, s.display_name, d.ats, d.config, d.country_filter, d.active, d.created_at, d.is_startup, d.startup_classified_at, d.startup_reason
      from (values ${pairs(plans)}) as m(dead, surv)
      join target_company d on d.company_key = m.dead join company s on s.company_key = m.surv
      where not exists (select 1 from target_company t where t.company_key = m.surv)
      order by m.surv, d.active desc, d.created_at`);

    const dropped: Record<string, string[]> = {};
    for (const [table, pk, extra] of [["job_posting", "id", ", j.external_id"], ["company_probe", "company_key", ""]] as const) {
      const rows = await run<{ d: string }>(tx, sql`delete from ${sql.raw(table)} where ${sql.raw(pk)}::text in (${duplicateIds(plans, table, pk, extra)}) returning ${sql.raw(pk)}::text as d`);
      dropped[table] = rows.map((r) => r.d);
    }

    const movedIds: Record<string, Record<string, string[]>> = {};
    for (const [table, pk] of REPOINT) {
      const rows = await run<{ moved_id: string; moved_from: string }>(tx, sql`
        update ${sql.raw(table)} as r set company_key = m.surv from (values ${pairs(plans)}) as m(dead, surv)
        where r.company_key = m.dead returning r.${sql.raw(pk)}::text as moved_id, m.dead as moved_from`);
      const byDead: Record<string, string[]> = {};
      for (const r of rows) (byDead[r.moved_from] ??= []).push(r.moved_id);
      movedIds[table] = byDead;
    }

    // The deletes below cascade through real FKs: prove nothing still points at a dead key first.
    const left = await countRefs(tx, deads);
    const stray = COMPANY_KEY_TABLES.filter((t) => t !== "company" && t !== "target_company" && deads.some((k) => refCount(left, t, k) > 0));
    if (stray.length) throw new Error(`Rows still reference a dead key in: ${stray.join(", ")}. Nothing was written.`);
    // Matched proposals become 'applied' BEFORE the dead company rows go (their FK is SET NULL, so the row survives as
    // history). `status = 'open'` is the open -> applied transition of absorption.ts#canTransition, and the rows were
    // locked by the read above, so the count must match or something is wrong and nothing is written.
    if (proposals.matched.length) {
      const marked = await run(tx, sql`
        update company_absorption_proposal set status = 'applied', resolved_by_bd_id = ${actorBdId}::uuid, resolved_at = now()
        where status = 'open' and id::text in (${list(proposals.matched.map((m) => m.id))}) returning id`);
      if (marked.length !== proposals.matched.length) throw new Error(`Expected to mark ${proposals.matched.length} proposals applied, marked ${marked.length}. Nothing was written.`);
    }
    const deadTargets = await run(tx, sql`delete from target_company where company_key in (${list(deads)}) returning to_jsonb(target_company) as snapshot`);
    const deadCompanies = await run(tx, sql`delete from company where company_key in (${list(deads)}) returning to_jsonb(company) - 'notes' as snapshot`);
    if (deadCompanies.length !== deads.length) throw new Error(`Expected to delete ${deads.length} company rows, deleted ${deadCompanies.length}.`);

    const patches = plans.filter((p) => p.changes.length).map((p) => ({ company_key: p.survivorKey, ...Object.fromEntries(Object.entries(MERGE_FIELDS).map(([f, [col]]) => [col, p.merged[f as keyof CompanyRow]])) }));
    if (patches.length) {
      const cols = Object.values(MERGE_FIELDS);
      const patched = await run(tx, sql`
        update company c set ${sql.raw(cols.map(([c]) => `${c} = v.${c}`).join(", "))}, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
        from jsonb_to_recordset(${JSON.stringify(patches)}::jsonb) as v(company_key text, ${sql.raw(cols.map(([c, t]) => `${c} ${t}`).join(", "))})
        where c.company_key = v.company_key returning c.company_key`);
      if (patched.length !== patches.length) throw new Error(`Expected to patch ${patches.length} survivors, patched ${patched.length}.`);
      await tx.insert(companyPropertyHistory).values(
        plans.flatMap((p) => p.changes.map((c) => ({ companyKey: p.survivorKey, property: c.field, oldValue: c.oldValue, newValue: c.newValue, changedByBdId: actorBdId, source: "merge" }))),
      );
    }

    // Without these the next import of a merged-away name recreates the duplicate (imports resolve through company_alias).
    const aliases = await run<{ alias_key: string }>(tx, sql`insert into company_alias (alias_key, company_key) values ${pairs(plans)} on conflict (alias_key) do nothing returning alias_key`);

    const [audit] = await tx.insert(auditLog).values({
      actorBdId,
      action: MERGE_AUDIT_ACTION,
      // Not row-by-row reversible once keys are repointed: `movedIds` (table -> dead key -> ids) is what a manual
      // reconstruction starts from, `deletedCompanies`/`deletedTargetCompanies` are the dead rows (company minus notes).
      metadata: {
        groups: plans.map((p) => ({ survivorKey: p.survivorKey, deadKeys: p.deadKeys, displayNames: p.displayNames })),
        repointed: moved, movedIds, deletedDuplicates: dropped,
        discarded: plans.flatMap((p) => p.discarded.map((d) => ({ survivorKey: p.survivorKey, ...d }))),
        deletedCompanies: deadCompanies.map((r) => (r as { snapshot: unknown }).snapshot),
        deletedTargetCompanies: deadTargets.map((r) => (r as { snapshot: unknown }).snapshot),
        createdTargetCompanies: targetsToCreate, aliasesWritten: aliases.map((a) => a.alias_key),
        // Proposals marked applied (revert: set status back to 'open' and clear resolved_*; the absorbed key is gone, see
        // the deleted company snapshots) and open ones the groups contradicted, left untouched.
        appliedProposals: proposals.matched, divergentProposals: proposals.divergent,
      },
    }).returning({ id: auditLog.id });
    return { plans, moved, proposals, auditLogId: audit!.id };
  });
}

/** Reporting only: squash-heuristic duplicate candidates for a human to confirm. Never an input to execute. */
export async function readCandidateRecords(match: string | null): Promise<CandidateRecord[]> {
  const needle = match === null ? null : squashCompanyKey(match);
  // A filter that squashes to nothing (a non-Latin name) can match no squashed key. It used to fall through to "no
  // filter" and list every candidate group, which reads as if the filter had matched them all.
  if (match !== null && needle === null) return [];
  const rows = await db.execute(sql`
    with pc_n as (select company_key as pc_key, count(*)::int as pc_contacts from person where merged_into_id is null and company_key is not null group by company_key),
    sq_rows as (
      select c.company_key as sq_key, c.display_name as sq_name, c.relationship_stage as sq_stage, c.domain as sq_domain,
        coalesce(n.pc_contacts, 0) as sq_contacts, regexp_replace(lower(c.company_key), '[^a-z0-9]', '', 'g') as sq_squash
      from company c left join pc_n n on n.pc_key = c.company_key)
    select sq_key as "companyKey", sq_name as "displayName", sq_stage as stage, sq_domain as domain, sq_contacts as contacts, sq_squash as squash
    from sq_rows
    where sq_squash <> '' and ${needle ? sql`sq_squash like ${"%" + needle + "%"} and` : sql``}
      sq_squash in (select sq_squash from sq_rows where sq_squash <> '' group by sq_squash having count(*) > 1)
    order by sq_squash, sq_contacts desc, sq_key limit 1000`);
  return (rows as unknown as CandidateRecord[]).map((r) => ({ ...r, contacts: Number(r.contacts) }));
}
