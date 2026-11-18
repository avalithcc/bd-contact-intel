import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, tender } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { StoredRelevance, TenderVerdicts } from "./classify";
import { tenderKey, type TenderInput } from "./parse";
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
  /** Rows that got a model verdict in this import. */
  classified: number;
}

/** One read of the relevance state of the file's rows, so the importer knows which ones are worth a model call. */
export async function loadRelevanceState(
  numbers: readonly string[],
  database: Pick<typeof db, "select"> = db,
): Promise<Map<string, StoredRelevance>> {
  const out = new Map<string, StoredRelevance>();
  if (numbers.length === 0) return out;
  const rows = await database
    .select({ processNumber: tender.processNumber, name: tender.name, aiRelevant: tender.aiRelevant, relevanceOverride: tender.relevanceOverride })
    .from(tender)
    .where(inArray(tender.processNumber, [...numbers]));
  for (const r of rows) out.set(tenderKey(r.processNumber), r);
  return out;
}

function chunks<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** A fresh verdict wins; with none, the old one stays unless the title changed (then it no longer applies). */
const verdictColumn = (column: string) =>
  sql.raw(`case when excluded.${column} is not null then excluded.${column} when excluded.name <> tender.name then null else tender.${column} end`);

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
 * Only the portal's columns and the model's verdict are written; `triage_status`, `note` and `relevance_override` are never in
 * the SET list, so re-importing cannot undo a human decision. A row with no verdict keeps its old one, unless its title
 * changed (the old verdict judged a different title, so it goes back to unclassified, which is shown).
 * Revert: `audit_log.metadata.createdNumbers` are the rows to delete, `metadata.updatedBefore` holds the previous portal
 * columns of every updated row, and `metadata.classifiedNumbers` are the rows whose verdict can be reset with
 * `update tender set ai_relevant = null, ai_reason = null, ai_classified_at = null where process_number = any(...)`.
 */
export async function importTenders(
  tenders: readonly TenderInput[],
  actorBdId: string,
  database: Database = db,
  verdicts: TenderVerdicts = new Map(),
): Promise<TenderImportResult> {
  if (!isUuid(actorBdId)) throw new Error("importTenders: actorBdId must be a uuid");
  if (tenders.length > MAX_TENDERS_PER_IMPORT) {
    throw new Error(`importTenders: ${tenders.length} rows exceeds the cap of ${MAX_TENDERS_PER_IMPORT}`);
  }
  if (tenders.length === 0) return { created: 0, updated: 0, unchanged: 0, classified: 0 };

  return database.transaction(async (tx) => {
    const numbers = tenders.map((t) => t.processNumber);
    const rows = await tx.select().from(tender).where(inArray(tender.processNumber, numbers));
    const existing = indexTendersByKey<StoredTender>(rows);
    const plan = planTenderImport(tenders, existing, verdicts);

    const writes = [...plan.create, ...plan.update, ...plan.verdictOnly];
    const classifiedAt = new Date();
    let classified = 0;
    for (const batch of chunks(writes, WRITE_BATCH)) {
      await tx
        .insert(tender)
        .values(
          batch.map((t) => {
            const v = verdicts.get(tenderKey(t.processNumber));
            if (v) classified += 1;
            return { ...portalColumns(t), aiRelevant: v?.relevant ?? null, aiReason: v?.reason ?? null, aiClassifiedAt: v ? classifiedAt : null };
          }),
        )
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
            aiRelevant: verdictColumn("ai_relevant"),
            aiReason: verdictColumn("ai_reason"),
            aiClassifiedAt: verdictColumn("ai_classified_at"),
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
          classified,
          classifiedNumbers: [...verdicts.keys()].slice(0, AUDIT_LIST_CAP),
          createdNumbers: plan.create.slice(0, AUDIT_LIST_CAP).map((t) => t.processNumber),
          updatedBefore: plan.update.slice(0, AUDIT_LIST_CAP).map((t) => {
            const before = existing.get(t.processNumber)!;
            return { ...portalColumns(before), openingAt: before.openingAt.toISOString() };
          }),
        },
      });
    }
    return { created: plan.create.length, updated: plan.update.length, unchanged: plan.unchanged, classified };
  });
}

/**
 * Changes our triage state on one tender and, when a BD is named, logs the move (from and to) in the same statement; picking
 * the state it already has logs nothing. False when the id matches nothing; throws on an invalid state or id.
 */
export async function setTenderTriage(
  id: string,
  status: TenderTriage,
  database: Pick<typeof db, "execute"> = db,
  actorBdId: string | null = null,
): Promise<boolean> {
  if (!isUuid(id)) throw new Error("setTenderTriage: id must be a uuid");
  if (!isTenderTriage(status)) throw new Error(`setTenderTriage: unknown state ${String(status)}`);
  const rows = (await database.execute(sql`
    with old as (select triage_status from tender where id = ${id}::uuid),
    upd as (update tender set triage_status = ${status}::text, updated_at = now() where id = ${id}::uuid returning id),
    ev as (
      insert into tender_event (tender_id, actor_bd_id, kind, detail, created_at)
      select upd.id, ${actorBdId}::uuid, 'triage', jsonb_build_object('from', old.triage_status, 'to', ${status}::text), clock_timestamp()
      from upd, old where old.triage_status <> ${status}::text
      returning 1
    )
    select (select count(*) from upd)::int as found`)) as unknown as { found: number }[];
  return (rows[0]?.found ?? 0) > 0;
}
