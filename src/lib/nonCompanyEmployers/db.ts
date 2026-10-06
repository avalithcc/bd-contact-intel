/**
 * DB layer for scripts/clear-non-company-employers.ts (not unit-tested: importing `@/db` throws without
 * DATABASE_URL; the matching, the cascade guard and the history rows live in match.ts). The dry run is a READ ONLY
 * transaction. Execute re-reads inside its transaction after locking the matched company rows, so an activity
 * inserted since the dry run waits instead of being cascade-deleted, and STOPS when any STOP_TABLES row exists.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, personPropertyHistory } from "@/db/schema";
import { countRefs, list, run, type Tx } from "../companyMerge/db";
import { COMPANY_KEY_TABLES, refCount } from "../companyMerge/keys";
import { chunk, WRITE_BATCH_SIZE } from "../migration/collapseWriteRows";
import { isUuid } from "../uuid";
import { cascadeBlockers, CLEARED_TABLES, clearedHistoryRows, findNonCompanyKeys, type ClearedPerson } from "./match";

export const CLEANUP_AUDIT_ACTION = "clear_non_company_employers";
const ROW_CAP = 5_000;

async function read(tx: Tx, lock: boolean) {
  // Same squash as match.ts; the SQL only prefilters, the JS matcher decides.
  const squashed = sql`regexp_replace(lower(company_key), '[^a-z0-9]', '', 'g') ~ '(freelance|independiente)'`;
  const found = await run<{ k: string }>(tx, sql.join(COMPANY_KEY_TABLES.map((t) => sql`select company_key as k from ${sql.raw(t)} where ${squashed}`), sql` union `));
  const keys = findNonCompanyKeys(found.map((r) => r.k));
  if (!keys.length) return { keys, names: new Map<string, string[]>(), counts: new Map<string, number>(), blockers: [] as string[] };
  if (lock) await run(tx, sql`select 1 from company where company_key in (${list(keys)}) for update`);
  const named = await run<{ k: string; name: string }>(tx, sql`
    select company_key as k, display_name as name from company where company_key in (${list(keys)})
    union select company_key, company from person where company_key in (${list(keys)}) and company is not null
    union select company_key, company from contact where company_key in (${list(keys)}) and company is not null`);
  const names = new Map<string, string[]>();
  for (const n of named) names.set(n.k, [...(names.get(n.k) ?? []), n.name]);
  const counts = await countRefs(tx, keys);
  return { keys, names, counts, blockers: cascadeBlockers(counts, keys) };
}

export async function dryRunCleanup() {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return read(tx, false);
  });
}

export async function executeCleanup(actorBdId: string) {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) => {
    const r = await read(tx, true);
    if (!r.keys.length) return { ...r, auditLogId: null as string | null };
    if (r.blockers.length) throw new Error(`STOP, nothing written. Deleting these companies would cascade into real data:\n- ${r.blockers.join("\n- ")}`);
    const cleared = CLEARED_TABLES.reduce((n, t) => n + r.keys.reduce((m, k) => m + refCount(r.counts, t, k), 0), 0);
    if (cleared > ROW_CAP) throw new Error(`${cleared} rows would be cleared; the cap is ${ROW_CAP}.`);
    const where = sql`company_key in (${list(r.keys)})`;

    const persons = await run<ClearedPerson>(tx, sql`
      update person p set company = null, company_key = null, company_category = null, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
      from (select id, company, company_key, company_category from person where ${where}) o where p.id = o.id
      returning o.id::text as id, o.company as company, o.company_key as "companyKey", o.company_category as "companyCategory"`);
    for (const batch of chunk(clearedHistoryRows(persons, actorBdId), WRITE_BATCH_SIZE)) await tx.insert(personPropertyHistory).values(batch);
    const contacts = await run(tx, sql`
      update contact c set company = null, company_key = null, company_category = null
      from (select id, company, company_key from contact where ${where}) o where c.id = o.id
      returning o.id::text as id, o.company as company, o.company_key as "companyKey"`);
    const leads = await run(tx, sql`update lead l set company_key = null from (select id, company_key from lead where ${where}) o where l.id = o.id returning o.id::text as id, o.company_key as "companyKey"`);
    const candidates = await run(tx, sql`delete from board_candidate where ${where} returning id::text as id, company_key as "companyKey"`);
    const probes = await run(tx, sql`delete from company_probe where ${where} returning company_key as "companyKey"`);
    // Nothing STOP-listed references these keys (checked above), so the cascade removes only the junk records' own field history.
    const companies = await run<{ snapshot: unknown }>(tx, sql`delete from company where ${where} returning to_jsonb(company) - 'notes' as snapshot`);

    const [audit] = await tx.insert(auditLog).values({
      actorBdId,
      action: CLEANUP_AUDIT_ACTION,
      // Revert source: see the header of scripts/clear-non-company-employers.ts.
      metadata: {
        matchedKeys: r.keys, displayNames: Object.fromEntries(r.names), referenceCounts: Object.fromEntries(r.keys.map((k) => [k, Object.fromEntries(COMPANY_KEY_TABLES.map((t) => [t, refCount(r.counts, t, k)]))])),
        clearedPersons: persons, clearedContacts: contacts, clearedLeads: leads, deletedBoardCandidates: candidates, deletedProbes: probes, deletedCompanies: companies.map((c) => c.snapshot),
      },
    }).returning({ id: auditLog.id });
    return { ...r, auditLogId: audit!.id as string | null };
  });
}
