/**
 * Pure decisions for the `/companies` bulk "Estado de cliente" action. No
 * I/O: the transaction lives in bulkClientStatusDb.ts. The write semantics
 * are the single-record edit's (planCompanyPropertyEdit), applied per row, so
 * a bulk change leaves exactly the same provenance a one-by-one edit would.
 *
 * Setting `active`/`inactive` IS the assertion that a company is a client;
 * the third option, "No es cliente", writes NULL (clientStatus.ts). It is a
 * real value, not a cancel.
 */
import type { NewCompanyPropertyHistory } from "@/db/schema";
import { isClientStatus, type ClientStatus } from "@/lib/companies/clientStatus";
import { planCompanyPropertyEdit } from "@/lib/companies/propertyEdit";
import { AUDIT_LOG_ID_CAP } from "@/lib/contacts/bulkOwnerAudit";

/**
 * Above this many companies the dialog stops the BD and asks to type the
 * count. Marking a large set as clients empties the field's meaning (the
 * filter "Estado de cliente: Activo" would stop finding the real ones), and a
 * 50-row page is the largest set a BD checks by hand, so anything beyond ten
 * pages can only come from "select all matching" and deserves a pause.
 */
export const BULK_CLIENT_STATUS_CONFIRM_THRESHOLD = 500;

/** Hard cap on one run. Above the whole table (~14.6k companies) on purpose:
 * the guard shows the real matching count, so silently acting on fewer would
 * make the confirmation dishonest. */
export const BULK_COMPANY_TARGET_CAP = 20000;

/** Postgres allows 65,535 bind parameters per statement; slices stay far below it. */
export const BULK_WRITE_CHUNK = 2000;

export const AUDIT_KEY_CAP = AUDIT_LOG_ID_CAP;

/** `undefined` = not a valid dialog value. Blank means "No es cliente" (NULL). */
export function parseBulkClientStatusValue(raw: string): ClientStatus | null | undefined {
  if (raw === "") return null;
  return isClientStatus(raw) ? raw : undefined;
}

export function requiresCountConfirmation(count: number): boolean {
  return count > BULK_CLIENT_STATUS_CONFIRM_THRESHOLD;
}

/** Typed confirmation: digits only once separators ("14.543", "14,543") and spaces are dropped. */
export function isCountConfirmed(typed: string | null, count: number): boolean {
  if (typed === null) return false;
  return typed.replace(/[.,\s]/g, "") === String(count);
}

export function sanitizeBulkCompanyKeys(raw: unknown, cap: number = BULK_COMPANY_TARGET_CAP): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    seen.add(entry);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type HistoryRow = Omit<NewCompanyPropertyHistory, "id" | "at">;

export interface BulkClientStatusPlan {
  /** Companies whose value really changes: the only ones rewritten and audited. */
  toUpdate: string[];
  historyRows: HistoryRow[];
}

/** Idempotent: a row already holding the target yields no update and no history. */
export function planBulkClientStatus(
  rows: readonly { companyKey: string; clientStatus: string | null }[],
  target: ClientStatus | null,
  changedByBdId: string,
): BulkClientStatusPlan {
  const toUpdate: string[] = [];
  const historyRows: HistoryRow[] = [];
  for (const row of rows) {
    const plan = planCompanyPropertyEdit(row, "clientStatus", target ?? "", changedByBdId);
    if (!plan.changed) continue;
    toUpdate.push(row.companyKey);
    historyRows.push(...plan.historyRows);
  }
  return { toUpdate, historyRows };
}

export type BulkClientStatusMode = "ids" | "filter";

export interface BulkClientStatusAuditInput {
  actorBdId: string;
  clientStatus: ClientStatus | null;
  mode: BulkClientStatusMode;
  filtersQuery?: string;
  /** Companies actually changed, not the raw request. */
  companyKeys: string[];
}

export function buildBulkClientStatusAuditRow(input: BulkClientStatusAuditInput) {
  const metadata: {
    count: number;
    mode: BulkClientStatusMode;
    clientStatus: ClientStatus | null;
    filtersQuery?: string;
    companyKeys: string[];
    truncated: boolean;
  } = {
    count: input.companyKeys.length,
    mode: input.mode,
    clientStatus: input.clientStatus,
    companyKeys: input.companyKeys.slice(0, AUDIT_KEY_CAP),
    truncated: input.companyKeys.length > AUDIT_KEY_CAP,
  };
  if (input.mode === "filter" && input.filtersQuery) metadata.filtersQuery = input.filtersQuery;
  return { actorBdId: input.actorBdId, action: "bulk_client_status_change" as const, targetBdId: null, metadata };
}
