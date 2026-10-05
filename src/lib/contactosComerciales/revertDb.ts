/**
 * Thin DB layer for scripts/revert-contactos-comerciales-2026-10.ts; the
 * decisions live in revert.ts. Dry run is a READ ONLY transaction. Execute
 * re-reads and re-plans inside one transaction under the identity lock, so a
 * contact worked on between the dry run and the write is kept, then writes ONE
 * audit_log row. Reads: audit row, per-contact touch flags (one query, one
 * correlated EXISTS per table), current phones, filled-phone history.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, person, personPropertyHistory } from "@/db/schema";
import { withIdentityLock } from "@/lib/identity/resolveDb";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import { CONTACTOS_AUDIT_ACTION } from "./db";
import { CONTACTOS_SOURCE_KEY } from "./plan";
import { planRevert, REFERENCING_TABLES, STATE_FLAGS, TOUCH_FLAGS, type RevertPlan, type TouchFlag } from "./revert";

export const REVERT_AUDIT_ACTION = "revert_contactos_comerciales_2026_10";
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface Loaded {
  audit: { id: string; at: Date; ownerBdId: string };
  plan: RevertPlan;
  filledIds: string[];
}

async function load(tx: DbTransaction, auditId: string | null): Promise<Loaded> {
  const [row] = await tx
    .select({ id: auditLog.id, at: auditLog.at, metadata: auditLog.metadata })
    .from(auditLog)
    .where(auditId ? and(eq(auditLog.id, auditId), eq(auditLog.action, CONTACTOS_AUDIT_ACTION)) : eq(auditLog.action, CONTACTOS_AUDIT_ACTION))
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (!row) throw new Error("No import audit_log row found: nothing to revert.");
  const meta = row.metadata as { ownerBdId?: string; createdPersonIds?: string[]; filledPersonIds?: string[] };
  const createdIds = meta.createdPersonIds ?? [];
  const filledIds = meta.filledPersonIds ?? [];
  if (![...createdIds, ...filledIds, meta.ownerBdId ?? ""].every(isUuid)) throw new Error("audit_log metadata holds a non-uuid id: refusing to run.");

  const refFlags = REFERENCING_TABLES.map(
    ([flag, table, cols]) =>
      sql`exists (select 1 from ${sql.raw(table)} r where ${sql.join(cols.map((c) => sql`r.${sql.raw(c)} = p.id`), sql` or `)}) as ${sql.raw(flag)}`,
  );
  const stateFlags = [
    sql`(p.merged_into_id is not null) as ${sql.raw(STATE_FLAGS[0])}`,
    sql`exists (select 1 from person m where m.merged_into_id = p.id) as ${sql.raw(STATE_FLAGS[1])}`,
    sql`exists (select 1 from person_property_history h where h.person_id = p.id and h.source <> 'import') as ${sql.raw(STATE_FLAGS[2])}`,
    sql`(p.owner_bd_id is distinct from ${meta.ownerBdId}::uuid or p.status <> 'new') as ${sql.raw(STATE_FLAGS[3])}`,
  ];
  const factRows = createdIds.length
    ? ((await tx.execute(sql`
        select p.id::text as id, ${sql.join([...refFlags, ...stateFlags], sql`, `)}
        from person p
        where p.source_key = ${CONTACTOS_SOURCE_KEY} and p.id in (${sql.join(createdIds.map((id) => sql`${id}::uuid`), sql`, `)})
      `)) as unknown as ({ id: string } & Record<TouchFlag, boolean>)[])
    : [];
  const facts = new Map(factRows.map((r) => [r.id, TOUCH_FLAGS.filter((f) => r[f])]));

  const phones = filledIds.length
    ? await tx.select({ id: person.id, phone: person.phone, mobilePhone: person.mobilePhone }).from(person).where(inArray(person.id, filledIds))
    : [];
  // Scoped to rows written by this import: older import history on the same people is never matched.
  const history = filledIds.length
    ? await tx
        .select({ personId: personPropertyHistory.personId, property: personPropertyHistory.property, newValue: personPropertyHistory.newValue })
        .from(personPropertyHistory)
        .where(
          and(
            inArray(personPropertyHistory.personId, filledIds),
            inArray(personPropertyHistory.property, ["phone", "mobilePhone"]),
            eq(personPropertyHistory.source, "import"),
            gte(personPropertyHistory.at, row.at),
          ),
        )
    : [];
  const plan = planRevert({
    createdIds,
    facts,
    fills: history.filter((h) => h.newValue).map((h) => ({ personId: h.personId, property: h.property, filledValue: h.newValue! })),
    currentPhones: new Map(phones.map((p) => [p.id, { phone: p.phone, mobilePhone: p.mobilePhone }])),
  });
  return { audit: { id: row.id, at: row.at, ownerBdId: meta.ownerBdId! }, plan, filledIds };
}

export async function dryRunRevert(auditId: string | null): Promise<RevertPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return (await load(tx, auditId)).plan;
  });
}

export async function executeRevert(auditId: string | null, actorBdId: string): Promise<{ plan: RevertPlan; auditLogId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) =>
    withIdentityLock(tx, async () => {
      const { audit, plan } = await load(tx, auditId);
      if (!plan.deletable.length && !plan.clears.length) return { plan, auditLogId: null };

      for (const batch of chunk(plan.deletable, WRITE_BATCH_SIZE)) {
        const gone = await tx.delete(person).where(and(inArray(person.id, batch), eq(person.sourceKey, CONTACTOS_SOURCE_KEY))).returning({ id: person.id });
        if (gone.length !== batch.length) throw new Error(`Expected to delete ${batch.length} contacts, deleted ${gone.length}.`);
      }
      // Each column goes back to NULL only where it still holds the filled value (re-checked in SQL).
      const written = new Map<string, string>();
      for (const [column, property] of [["phone", "phone"], ["mobile_phone", "mobilePhone"]] as const) {
        const targets = plan.clears.filter((c) => c[property]);
        if (!targets.length) continue;
        const ids = targets.map((t) => t.personId);
        const updated = await tx
          .update(person)
          .set({ [property]: null })
          .where(and(inArray(person.id, ids), sql`${sql.raw(column)} in (select h.new_value from person_property_history h where h.person_id = person.id and h.property = ${property} and h.source = 'import' and h.at >= ${audit.at.toISOString()}::timestamptz)`))
          .returning({ id: person.id });
        if (updated.length !== ids.length) throw new Error(`Expected to clear ${ids.length} ${column} value(s), cleared ${updated.length}.`);
        await tx
          .delete(personPropertyHistory)
          .where(and(inArray(personPropertyHistory.personId, ids), eq(personPropertyHistory.property, property), eq(personPropertyHistory.source, "import"), gte(personPropertyHistory.at, audit.at)));
        written.set(column, String(ids.length));
      }
      const [log] = await tx
        .insert(auditLog)
        .values({
          actorBdId,
          action: REVERT_AUDIT_ACTION,
          metadata: { revertedAuditId: audit.id, deletedPersonIds: plan.deletable, keptCount: plan.kept.length, missing: plan.missing, clearedColumns: Object.fromEntries(written), changedSince: plan.changedSince },
        })
        .returning({ id: auditLog.id });
      return { plan, auditLogId: log!.id };
    }),
  );
}
