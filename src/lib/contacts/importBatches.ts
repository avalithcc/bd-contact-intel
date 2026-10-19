/**
 * Browser-side batching for the LinkedIn connections import. A 13k-row file
 * in one server action blew Vercel's 300 s limit (2026-10-19); the browser now
 * parses the CSV and sends it in sequential batches, each well under a minute.
 * Client-safe: no server-only imports. The server re-validates every batch
 * with `sanitizeConnectionsBatch`, it never trusts the client's shape.
 */
import { normalizeProfileKey, type ParsedConnection } from "@/lib/csv";
import type { IdentityIngestReport } from "@/lib/identity/ingestWrite";

/** Rows per server call. Two 500-row write chunks; payload ~250 KB, far below the 4 MB action body limit. */
export const CONNECTIONS_BATCH_SIZE = 1000;
/** Hard cap the server enforces per call, so a bad client cannot ask for an unbounded write. */
export const CONNECTIONS_BATCH_MAX_ROWS = 2000;
const MAX_FIELD_LENGTH = 500;

export interface ImportBatchOutcome {
  created: number;
  updated: number;
  unchanged: number;
  skippedOwnCompany: number;
  identityReport: IdentityIngestReport | null;
}

export function emptyImportTotals(): ImportBatchOutcome {
  return { created: 0, updated: 0, unchanged: 0, skippedOwnCompany: 0, identityReport: null };
}

export function splitIntoBatches<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function addReports(a: IdentityIngestReport | null, b: IdentityIngestReport | null): IdentityIngestReport | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    rowsRead: a.rowsRead + b.rowsRead,
    ownCompanySkipped: a.ownCompanySkipped + b.ownCompanySkipped,
    autoMerged: a.autoMerged + b.autoMerged,
    flaggedForReview: a.flaggedForReview + b.flaggedForReview,
    new: a.new + b.new,
  };
}

export function addImportOutcome(total: ImportBatchOutcome, batch: ImportBatchOutcome): ImportBatchOutcome {
  return {
    created: total.created + batch.created,
    updated: total.updated + batch.updated,
    unchanged: total.unchanged + batch.unchanged,
    skippedOwnCompany: total.skippedOwnCompany + batch.skippedOwnCompany,
    identityReport: addReports(total.identityReport, batch.identityReport),
  };
}

export type SendBatchResult = { ok: true; outcome: ImportBatchOutcome } | { ok: false; detail?: string };

export type BatchedImportResult =
  | { ok: true; totals: ImportBatchOutcome }
  | { ok: false; totals: ImportBatchOutcome; failedBatch: number; totalBatches: number; detail?: string };

/**
 * Sends the batches one after another and stops at the first failure.
 * Earlier batches stay written (the server write is idempotent), so a retry
 * of the same file simply reports them as unchanged and continues.
 */
export async function runBatchedImport(
  rows: readonly ParsedConnection[],
  opts: {
    send: (batch: ParsedConnection[]) => Promise<SendBatchResult>;
    batchSize?: number;
    onProgress?: (rowsDone: number, rowsTotal: number) => void;
  },
): Promise<BatchedImportResult> {
  const batches = splitIntoBatches(rows, opts.batchSize ?? CONNECTIONS_BATCH_SIZE);
  let totals = emptyImportTotals();
  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    let res: SendBatchResult;
    try {
      res = await opts.send(batches[i]);
    } catch (err) {
      res = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      return { ok: false, totals, failedBatch: i + 1, totalBatches: batches.length, detail: res.detail };
    }
    totals = addImportOutcome(totals, res.outcome);
    done += batches[i].length;
    opts.onProgress?.(done, rows.length);
  }
  return { ok: true, totals };
}

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, MAX_FIELD_LENGTH) : null;
}

/**
 * Server-side gate for a batch received from the browser. Returns null when
 * the payload is not an array or exceeds the cap; drops rows without a usable
 * profile key (they cannot take part in dedup), re-normalizes the key and
 * coerces every other field to a bounded string or null.
 */
export function sanitizeConnectionsBatch(input: unknown): ParsedConnection[] | null {
  if (!Array.isArray(input) || input.length > CONNECTIONS_BATCH_MAX_ROWS) return null;
  const out: ParsedConnection[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const profileKey = typeof r.profileKey === "string" ? normalizeProfileKey(r.profileKey.slice(0, 2000)) : null;
    if (!profileKey) continue;
    out.push({
      profileKey,
      firstName: cleanText(r.firstName),
      lastName: cleanText(r.lastName),
      company: cleanText(r.company),
      position: cleanText(r.position),
      email: cleanText(r.email),
      connectedOn: cleanText(r.connectedOn),
    });
  }
  return out;
}
