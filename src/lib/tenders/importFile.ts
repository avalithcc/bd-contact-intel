import { importTenders, type TenderImportResult } from "./importDb";
import { parseTenderSheet, type RejectedRow } from "./parse";
import { readSheetRows } from "./readSheet";
import type { db } from "@/db";

export interface TenderImportReport extends TenderImportResult {
  /** Rows the file had but could not be used (no number, unreadable date, repeated number). Never silently dropped. */
  rejected: RejectedRow[];
}

/** Portal export (.xls/.xlsx bytes) in, a full account of what happened out. Throws TenderSheetError for the wrong file. */
export async function importTenderFile(
  file: Buffer | ArrayBuffer,
  actorBdId: string,
  database: Pick<typeof db, "transaction"> | undefined = undefined,
): Promise<TenderImportReport> {
  const { tenders, rejected } = parseTenderSheet(readSheetRows(file));
  const result = await importTenders(tenders, actorBdId, database);
  return { ...result, rejected };
}
