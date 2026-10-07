/**
 * Thin DB layer for scripts/backfill-fi-arg-fields.ts; every decision lives in
 * plan.ts (unit-tested). ONE read: the fi-arg leads joined to their person via
 * person_id_map. The dry run is a READ ONLY transaction. Execute re-reads and
 * re-plans inside one transaction, re-guards every fill in SQL (a value a BD set
 * since the read is never overwritten, and a conflict aborts the whole run),
 * writes one person_property_history row per filled field and ONE audit_log row.
 * No persons are created, so the identity lock is not needed.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, personPropertyHistory } from "@/db/schema";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import { FI_ARG_SOURCE_KEY, FILL_FIELDS, planFiArgBackfill, type FiArgFill, type FiArgReport, type FiArgRow } from "./plan";

export const FI_ARG_AUDIT_ACTION = "backfill_fi_arg_fields";
export const FI_ARG_HISTORY_SOURCE = "import";
const ROW_CAP = 5_000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Raw = {
  lead_id: string; person_id: string | null; in_scope: boolean;
  company_display: string | null; company_raw: string | null;
  lead_city: string | null; lead_country: string | null; lead_seniority: string | null;
  company: string | null; city: string | null; country: string | null; seniority: string | null;
};

/** ONE read: each lead's own values and its person's current state in the same
 * row, so the planner needs no second input and no re-matching. `lead` already
 * holds everything the attendee CSVs did — see plan.ts's header for why this
 * reads no files. LEFT JOIN on purpose: a lead with no person is counted, not
 * dropped silently. */
async function readRows(tx: DbTransaction): Promise<FiArgRow[]> {
  const rows = (await tx.execute(sql`
    select l.id::text as lead_id, p.id::text as person_id,
      (p.id is not null and p.merged_into_id is null and p.source_key = ${FI_ARG_SOURCE_KEY}) as in_scope,
      l.company_display, l.company_raw,
      l.city as lead_city, l.country as lead_country, l.seniority as lead_seniority,
      p.company, p.city, p.country, p.seniority
    from lead l
    left join person_id_map m on m.legacy_table = 'lead' and m.legacy_id = l.id
    left join person p on p.id = m.person_id
    where l.source_key = ${FI_ARG_SOURCE_KEY}
    limit ${ROW_CAP + 1}
  `)) as unknown as Raw[];
  if (rows.length > ROW_CAP) throw new Error(`More than ${ROW_CAP} fi-arg leads: refusing to plan against a truncated set.`);
  return rows.map((r) => ({
    leadId: r.lead_id,
    personId: r.person_id,
    inScope: Boolean(r.in_scope),
    source: { companyDisplay: r.company_display, companyRaw: r.company_raw, city: r.lead_city, country: r.lead_country, seniority: r.lead_seniority },
    current: { company: r.company, city: r.city, country: r.country, seniority: r.seniority },
  }));
}

export async function dryRunFiArg(): Promise<{ fills: FiArgFill[]; report: FiArgReport }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return planFiArgBackfill(await readRows(tx));
  });
}

export async function executeFiArg(actorBdId: string): Promise<{ fills: FiArgFill[]; report: FiArgReport; auditLogId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) => {
    const { fills, report } = planFiArgBackfill(await readRows(tx));
    if (!fills.length) return { fills, report, auditLogId: null };
    for (const f of fills) if (!isUuid(f.personId)) throw new Error(`Planned fill target is not a uuid: ${f.personId}`);

    // One row per person with up to four columns, so UPDATE ... FROM matches each id once.
    const targets = new Map<string, Record<string, string | null>>();
    for (const f of fills) targets.set(f.personId, { ...(targets.get(f.personId) ?? { company: null, city: null, country: null, seniority: null }), [f.property]: f.value });
    for (const batch of chunk([...targets], WRITE_BATCH_SIZE)) {
      const values = batch.map(([id, t]) => sql`(${id}::uuid, ${t.company}::text, ${t.city}::text, ${t.country}::text, ${t.seniority}::text)`);
      const empty = (col: string) => sql`btrim(coalesce(p.${sql.raw(col)}, '')) = ''`;
      const set = (col: string) => sql`${sql.raw(col)} = case when v.${sql.raw(col)} is not null then v.${sql.raw(col)} else p.${sql.raw(col)} end`;
      const updated = (await tx.execute(sql`
        update person as p
        set ${sql.join(FILL_FIELDS.map(set), sql`, `)}, updated_at = now(), updated_by_bd_id = ${actorBdId}::uuid
        from (values ${sql.join(values, sql`, `)}) as v(id, company, city, country, seniority)
        where p.id = v.id and p.merged_into_id is null and p.source_key = ${FI_ARG_SOURCE_KEY}
          and ${sql.join(FILL_FIELDS.map((c) => sql`(v.${sql.raw(c)} is null or ${empty(c)})`), sql` and `)}
        returning p.id::text as id
      `)) as unknown as { id: string }[];
      if (updated.length !== batch.length) throw new Error(`Expected to fill ${batch.length} contacts, filled ${updated.length}: a value appeared since the plan was built.`);
    }
    for (const batch of chunk(fills, WRITE_BATCH_SIZE)) {
      await tx.insert(personPropertyHistory).values(batch.map((f) => ({ personId: f.personId, property: f.property, oldValue: null, newValue: f.value, changedByBdId: actorBdId, source: FI_ARG_HISTORY_SOURCE })));
    }
    const [audit] = await tx
      .insert(auditLog)
      .values({
        actorBdId,
        action: FI_ARG_AUDIT_ACTION,
        // Revert: see the header of scripts/backfill-fi-arg-fields.ts. Ids are listed per field.
        metadata: { sourceKey: FI_ARG_SOURCE_KEY, report, filledPersonIds: Object.fromEntries(FILL_FIELDS.map((c) => [c, fills.filter((f) => f.property === c).map((f) => f.personId)])) },
      })
      .returning({ id: auditLog.id });
    return { fills, report, auditLogId: audit!.id };
  });
}
