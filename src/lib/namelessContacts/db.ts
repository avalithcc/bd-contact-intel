/**
 * Thin DB layer for scripts/delete-nameless-imported-contacts.ts; the decisions
 * live in plan.ts, the touch-flag query is the one the commercial-contacts
 * revert uses (readTouchFlags). Reads: the import's audit row (for the owner it
 * assigned), the nameless selection, and the touch flags. Dry run is a READ ONLY
 * transaction. Execute re-reads and re-plans inside one transaction under the
 * identity lock, deletes in batches re-checking source_key AND both names NULL
 * in SQL, and writes ONE audit_log row that also holds the deleted rows, which
 * is the revert path (they are plain person rows; the import wrote no history
 * for them beyond what the guard allows).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, person } from "@/db/schema";
import { CONTACTOS_AUDIT_ACTION } from "@/lib/contactosComerciales/db";
import { CONTACTOS_SOURCE_KEY } from "@/lib/contactosComerciales/plan";
import { readTouchFlags } from "@/lib/contactosComerciales/revertDb";
import { withIdentityLock } from "@/lib/identity/resolveDb";
import { chunk, WRITE_BATCH_SIZE } from "@/lib/migration/collapseWriteRows";
import { isUuid } from "@/lib/uuid";
import { NAMELESS_AUDIT_ACTION, NAMELESS_SCAN_CAP, planNamelessDeletion, type NamelessPlan } from "./plan";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function load(tx: DbTransaction, expected: number): Promise<NamelessPlan> {
  const [imp] = await tx.select({ metadata: auditLog.metadata }).from(auditLog).where(eq(auditLog.action, CONTACTOS_AUDIT_ACTION)).orderBy(desc(auditLog.at)).limit(1);
  const importOwner = (imp?.metadata as { ownerBdId?: string } | undefined)?.ownerBdId;
  if (!importOwner || !isUuid(importOwner)) throw new Error("No import audit_log row with an owner found: refusing to run.");

  const selected = await tx
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.sourceKey, CONTACTOS_SOURCE_KEY), isNull(person.firstName), isNull(person.lastName)))
    .orderBy(person.id)
    .limit(NAMELESS_SCAN_CAP + 1);
  const ids = selected.map((r) => r.id);
  if (ids.length > NAMELESS_SCAN_CAP) throw new Error(`More than ${NAMELESS_SCAN_CAP} persons match: over the cap, refusing.`);
  return planNamelessDeletion(ids, await readTouchFlags(tx, ids, importOwner), expected);
}

export async function dryRunNameless(expected: number): Promise<NamelessPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return load(tx, expected);
  });
}

export async function executeNameless(expected: number, actorBdId: string): Promise<{ plan: NamelessPlan; auditLogId: string | null }> {
  if (!isUuid(actorBdId)) throw new Error("--actor must be a bd uuid.");
  return db.transaction(async (tx) =>
    withIdentityLock(tx, async () => {
      const plan = await load(tx, expected);
      if (!plan.deletable.length) return { plan, auditLogId: null };

      // Plain person rows: the revert path (re-insert them) lives in the audit row.
      const snapshot = await tx.select().from(person).where(inArray(person.id, plan.deletable));
      for (const batch of chunk(plan.deletable, WRITE_BATCH_SIZE)) {
        const gone = await tx
          .delete(person)
          .where(and(inArray(person.id, batch), eq(person.sourceKey, CONTACTOS_SOURCE_KEY), isNull(person.firstName), isNull(person.lastName)))
          .returning({ id: person.id });
        if (gone.length !== batch.length) throw new Error(`Expected to delete ${batch.length} contacts, deleted ${gone.length}.`);
      }
      const [audit] = await tx
        .insert(auditLog)
        .values({
          actorBdId,
          action: NAMELESS_AUDIT_ACTION,
          metadata: {
            sourceKey: CONTACTOS_SOURCE_KEY,
            expected,
            deletedPersonIds: plan.deletable,
            keptCount: plan.kept.length,
            keptReasons: plan.keptReasons,
            // Revert: re-INSERT these rows into person (same ids); their cascaded history, if any, is not restored.
            deletedPersons: snapshot,
          },
        })
        .returning({ id: auditLog.id });
      return { plan, auditLogId: audit!.id };
    }),
  );
}
