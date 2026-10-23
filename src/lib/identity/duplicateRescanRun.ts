/**
 * Database layer of the duplicates re-scan, shared by the daily cron
 * (src/app/api/duplicates/rescan/route.ts) and the admin "Re-escanear" action
 * so the two can never drift. The decisions live in duplicateRescan.ts (pure).
 * Takes `database` as a parameter (type-only `@/db` import), like
 * ownerBackfillRun.ts.
 *
 * Writes: ONE transaction, batched `insert ... on conflict do nothing` (the
 * `duplicate_candidate_pair_unique` constraint ignores status, so a merged or
 * not_duplicate pair can never come back) plus ONE audit_log row. A dry run
 * writes neither. Revert path: the audit row's metadata.createdIds lists the
 * inserted candidates; `delete from duplicate_candidate where id = any(ids)
 * and status = 'open'` undoes a run (persons are never touched).
 */
import { and, desc, eq, isNull, or, isNotNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { auditLog, bd, duplicateCandidate, person } from "@/db/schema";
import { planDuplicateRescan, findRescanPairs, type RescanPerson, type RescanPlan, type RescanReport } from "@/lib/identity/duplicateRescan";
import type { ExistingDuplicateCandidatePair } from "@/lib/identity/nameFromEmailBackfill";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";

export const DUPLICATE_RESCAN_AUDIT_ACTION = "duplicates_rescan";
export type DuplicateRescanTrigger = "cron" | "manual";
/** Safety bound of the single person read; reaching it refuses the run instead of scanning a truncated set. */
export const RESCAN_PERSON_READ_CAP = 150_000;

type Database = typeof db;

/** Live persons that have a company to key on — one set-based read. */
export async function readRescanPersons(database: Database): Promise<RescanPerson[]> {
  const rows = await database
    .select({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      company: person.company,
      companyKey: person.companyKey,
      email: person.email,
    })
    .from(person)
    .where(and(isNull(person.mergedIntoId), or(isNotNull(person.companyKey), isNotNull(person.company))))
    .limit(RESCAN_PERSON_READ_CAP + 1);
  if (rows.length > RESCAN_PERSON_READ_CAP) throw new Error(`duplicates rescan: more than ${RESCAN_PERSON_READ_CAP} persons, refusing a truncated scan`);
  return rows;
}

/** `duplicate_candidate` rows (any status) for exactly these pairs, in one round trip with a single json parameter. */
export async function readExistingPairs(
  database: Database,
  pairs: readonly { personAId: string; personBId: string }[],
): Promise<ExistingDuplicateCandidatePair[]> {
  if (pairs.length === 0) return [];
  const json = JSON.stringify(pairs.map((x) => ({ a: x.personAId, b: x.personBId })));
  const rows = (await database.execute(sql`
    select d.person_a_id::text as a, d.person_b_id::text as b, d.status
    from duplicate_candidate d
    join jsonb_to_recordset(${json}::jsonb) as t(a uuid, b uuid) on d.person_a_id = t.a and d.person_b_id = t.b
  `)) as unknown as { a: string; b: string; status: string }[];
  return rows.map((r) => ({ personAId: r.a, personBId: r.b, status: r.status }));
}

export interface RescanLastRun {
  at: Date;
  trigger: DuplicateRescanTrigger;
  actorName: string | null;
  created: number;
  found: number;
  remaining: number;
  cap: number;
}

/** Most recent REAL run (a dry run writes no audit row). */
export async function readLastRescanRun(database: Database): Promise<RescanLastRun | null> {
  const [row] = await database
    .select({ at: auditLog.at, metadata: auditLog.metadata, actorName: bd.name })
    .from(auditLog)
    .leftJoin(bd, eq(bd.id, auditLog.actorBdId))
    .where(eq(auditLog.action, DUPLICATE_RESCAN_AUDIT_ACTION))
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (!row) return null;
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return {
    at: new Date(row.at),
    trigger: m.trigger === "cron" ? "cron" : "manual",
    actorName: row.actorName ?? null,
    created: n(m.created),
    found: n(m.found),
    remaining: n(m.remaining),
    cap: n(m.cap),
  };
}

/** Applies (or, on a dry run, only describes) a plan. See the file header for the write contract. */
export async function executeDuplicateRescan(
  database: Database,
  plan: RescanPlan,
  opts: { dryRun: boolean; trigger: DuplicateRescanTrigger; actorBdId: string },
): Promise<RescanReport> {
  const { toCreate, ...rest } = plan;
  const report: RescanReport = { ...rest, skipped: { ...plan.skipped }, dryRun: opts.dryRun, created: 0, planned: toCreate.length };
  if (opts.dryRun) return report;

  const createdIds: string[] = [];
  await database.transaction(async (tx) => {
    for (const batch of chunk(toCreate, WRITE_BATCH_SIZE)) {
      const inserted = await tx
        .insert(duplicateCandidate)
        .values(batch.map((c) => ({ personAId: c.personAId, personBId: c.personBId, reason: c.reason, matchKey: c.matchKey })))
        .onConflictDoNothing()
        .returning({ id: duplicateCandidate.id });
      createdIds.push(...inserted.map((r) => r.id));
    }
    report.created = createdIds.length;
    // A pair another writer created since the read is, by definition, already there: keep found = created + remaining + skipped.
    report.skipped.existing_other += toCreate.length - createdIds.length;
    await tx.insert(auditLog).values({
      actorBdId: opts.actorBdId,
      action: DUPLICATE_RESCAN_AUDIT_ACTION,
      metadata: {
        trigger: opts.trigger,
        scanned: report.scanned,
        groups: report.groups,
        ownCompanyPersons: report.ownCompanyPersons,
        found: report.found,
        created: report.created,
        cap: report.cap,
        capped: report.capped,
        remaining: report.remaining,
        skipped: report.skipped,
        createdIds,
      },
    });
  });
  return report;
}

/** Read, plan, then (unless dry) write. Two reads and one transaction, never per-row queries. */
export async function runDuplicateRescan(
  database: Database,
  opts: { dryRun: boolean; trigger: DuplicateRescanTrigger; actorBdId: string; cap: number },
): Promise<RescanReport> {
  const found = findRescanPairs(await readRescanPersons(database));
  const plan = planDuplicateRescan(found, await readExistingPairs(database, found.pairs), opts.cap);
  return executeDuplicateRescan(database, plan, opts);
}
