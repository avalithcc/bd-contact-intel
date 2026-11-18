import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, tender } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { TenderInput } from "./parse";
import { indexTendersByKey, planTenderImport, type StoredTender } from "./plan";
import { isTenderTriage, type TenderTriage } from "./triage";

export const TENDERS_IMPORT_AUDIT_ACTION = "tenders_import";
/** A bulk write is capped; the live portal set is 5 to 17 rows, a file of thousands is not the export we expect. */
export const MAX_TENDERS_PER_IMPORT = 1000;
const WRITE_BATCH = 200;
/** How many process numbers the audit row lists per bucket; counts are always exact. */
const AUDIT_LIST_CAP = 200;

type Database = Pick<typeof db, "transaction">;

export interface TenderImportResult {
  created: number;
  updated: number;
  unchanged: number;
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const portalColumns = (t: TenderInput) => ({
  processNumber: t.processNumber,
  fileNumber: t.fileNumber,
  name: t.name,
  processType: t.processType,
  openingAt: t.openingAt,
  portalStatus: t.portalStatus,
  executingUnit: t.executingUnit,
  financialAdminService: t.financialAdminService,
});

/**
 * Upserts tenders by process number in ONE transaction: one read of the existing rows, batched upserts, one audit_log row.
 * Only the portal's columns are written; `triage_status` and `note` are never in the SET list, so re-importing cannot undo a
 * decision. Revert: `audit_log.metadata.createdNumbers` are the rows to delete, `metadata.updatedBefore` holds the previous
 * portal columns of every updated row.
 */
export async function importTenders(
  tenders: readonly TenderInput[],
  actorBdId: string,
  database: Database = db,
): Promise<TenderImportResult> {
  if (!isUuid(actorBdId)) throw new Error("importTenders: actorBdId must be a uuid");
  if (tenders.length > MAX_TENDERS_PER_IMPORT) {
    throw new Error(`importTenders: ${tenders.length} rows exceeds the cap of ${MAX_TENDERS_PER_IMPORT}`);
  }
  if (tenders.length === 0) return { created: 0, updated: 0, unchanged: 0 };

  return database.transaction(async (tx) => {
    const numbers = tenders.map((t) => t.processNumber);
    const rows = await tx.select().from(tender).where(inArray(tender.processNumber, numbers));
    const existing = indexTendersByKey<StoredTender>(rows);
    const plan = planTenderImport(tenders, existing);

    const writes = [...plan.create, ...plan.update];
    for (const batch of chunks(writes, WRITE_BATCH)) {
      await tx
        .insert(tender)
        .values(batch.map(portalColumns))
        .onConflictDoUpdate({
          target: tender.processNumber,
          set: {
            fileNumber: sql`excluded.file_number`,
            name: sql`excluded.name`,
            processType: sql`excluded.process_type`,
            openingAt: sql`excluded.opening_at`,
            portalStatus: sql`excluded.portal_status`,
            executingUnit: sql`excluded.executing_unit`,
            financialAdminService: sql`excluded.financial_admin_service`,
            updatedAt: sql`now()`,
          },
        });
    }

    if (writes.length > 0) {
      await tx.insert(auditLog).values({
        actorBdId,
        action: TENDERS_IMPORT_AUDIT_ACTION,
        metadata: {
          created: plan.create.length,
          updated: plan.update.length,
          unchanged: plan.unchanged,
          createdNumbers: plan.create.slice(0, AUDIT_LIST_CAP).map((t) => t.processNumber),
          updatedBefore: plan.update.slice(0, AUDIT_LIST_CAP).map((t) => {
            const before = existing.get(t.processNumber)!;
            return { ...portalColumns(before), openingAt: before.openingAt.toISOString() };
          }),
        },
      });
    }
    return { created: plan.create.length, updated: plan.update.length, unchanged: plan.unchanged };
  });
}

/** Changes our triage state on one tender. False when the id matches nothing; throws on an invalid state or id. */
export async function setTenderTriage(id: string, status: TenderTriage, database: Pick<typeof db, "update"> = db): Promise<boolean> {
  if (!isUuid(id)) throw new Error("setTenderTriage: id must be a uuid");
  if (!isTenderTriage(status)) throw new Error(`setTenderTriage: unknown state ${String(status)}`);
  const rows = await database
    .update(tender)
    .set({ triageStatus: status, updatedAt: sql`now()` })
    .where(eq(tender.id, id))
    .returning({ id: tender.id });
  return rows.length > 0;
}
