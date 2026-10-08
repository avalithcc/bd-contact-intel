/**
 * Thin DB glue for the bulk "Estado de cliente" action. Not unit-tested
 * directly (imports `db`); the decisions live in bulkClientStatus.ts. Every
 * change, its company_property_history rows and the single audit_log row go
 * through ONE transaction, the same provenance the single-record edit writes
 * (propertyEditDb.ts).
 */
import { and, asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, company, companyPropertyHistory } from "@/db/schema";
import type { ClientStatus } from "@/lib/companies/clientStatus";
import {
  BULK_COMPANY_TARGET_CAP,
  BULK_WRITE_CHUNK,
  buildBulkClientStatusAuditRow,
  chunk,
  planBulkClientStatus,
  sanitizeBulkCompanyKeys,
  type BulkClientStatusMode,
} from "@/lib/companies/bulkClientStatus";
import { companyListConditions } from "@/lib/companies/listConditions";
import type { CompanyListParams } from "@/lib/companies/listParams";

/**
 * "Select all matching the filter": the SAME conditions the list's own WHERE
 * uses (companyListConditions + the hiring key list), one query, key-ordered
 * so a capped run is deterministic. Reads cap + 1 rows to know whether the
 * cap cut the set, instead of a second count query.
 */
export async function getCompanyKeysForFilters(
  params: CompanyListParams,
  meBdId: string,
  hiringKeys: string[],
  cap: number = BULK_COMPANY_TARGET_CAP,
): Promise<{ keys: string[]; wasLimited: boolean }> {
  const conditions = companyListConditions({ ...params, meBdId });
  if (params.view === "hiring") {
    if (!hiringKeys.length) return { keys: [], wasLimited: false };
    conditions.push(inArray(company.companyKey, hiringKeys));
  }
  const rows = await db
    .select({ companyKey: company.companyKey })
    .from(company)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(company.companyKey))
    .limit(cap + 1);
  return { keys: rows.slice(0, cap).map((r) => r.companyKey), wasLimited: rows.length > cap };
}

export interface BulkClientStatusResult {
  changed: number;
  unchanged: number;
}

export async function bulkSetClientStatus(
  rawKeys: unknown,
  target: ClientStatus | null,
  changedByBdId: string,
  options: { mode: BulkClientStatusMode; filtersQuery?: string },
): Promise<BulkClientStatusResult> {
  // Sorted so two overlapping bulk runs lock rows in the same order (no deadlock).
  const keys = sanitizeBulkCompanyKeys(rawKeys).sort();
  if (!keys.length) return { changed: 0, unchanged: 0 };

  return db.transaction(async (tx) => {
    const rows: { companyKey: string; clientStatus: string | null }[] = [];
    for (const slice of chunk(keys, BULK_WRITE_CHUNK)) {
      rows.push(
        ...(await tx
          .select({ companyKey: company.companyKey, clientStatus: company.clientStatus })
          .from(company)
          .where(inArray(company.companyKey, slice))
          // Row lock until commit: a concurrent edit cannot slip between this read
          // and the update below, so the history rows' old values are always true.
          .for("update")),
      );
    }

    const plan = planBulkClientStatus(rows, target, changedByBdId);
    const updatedAt = new Date();
    for (const slice of chunk(plan.toUpdate, BULK_WRITE_CHUNK)) {
      await tx
        .update(company)
        .set({ clientStatus: target, updatedAt, updatedByBdId: changedByBdId })
        .where(inArray(company.companyKey, slice));
    }
    for (const slice of chunk(plan.historyRows, BULK_WRITE_CHUNK)) {
      await tx.insert(companyPropertyHistory).values(slice);
    }
    if (plan.toUpdate.length) {
      await tx.insert(auditLog).values(
        buildBulkClientStatusAuditRow({
          actorBdId: changedByBdId,
          clientStatus: target,
          mode: options.mode,
          filtersQuery: options.filtersQuery,
          companyKeys: plan.toUpdate,
        }),
      );
    }
    return { changed: plan.toUpdate.length, unchanged: rows.length - plan.toUpdate.length };
  });
}
