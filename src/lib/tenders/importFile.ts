import { importTenders, loadRelevanceState, type TenderImportResult } from "./importDb";
import { classifyTenders, tendersToClassify, type TenderVerdicts } from "./classify";
import { parseTenderSheet, tenderKey, type RejectedRow, type TenderInput } from "./parse";
import { readSheetRows } from "./readSheet";
import type { db } from "@/db";

export interface TenderImportReport extends TenderImportResult {
  /** Rows the file had but could not be used (no number, unreadable date, repeated number). Never silently dropped. */
  rejected: RejectedRow[];
  /** Rows that needed a verdict and did not get one (model down, cut-off or skipped). They are shown, and retried next import. */
  unclassified: number;
}

/** The model call, injectable so a test never reaches the gateway. Must not throw; the default never does. */
export type TenderClassifier = (items: readonly TenderInput[]) => Promise<TenderVerdicts>;

/**
 * Portal export (.xls/.xlsx bytes) in, a full account of what happened out. Throws TenderSheetError for the wrong file.
 * Classification is ONE model call for the file, made before the transaction opens (a model call must not hold one) and
 * allowed to fail: the tenders land either way, unclassified, and an unclassified tender is shown.
 */
export async function importTenderFile(
  file: Buffer | ArrayBuffer,
  actorBdId: string,
  database: Pick<typeof db, "transaction" | "select"> | undefined = undefined,
  classify: TenderClassifier = classifyTenders,
): Promise<TenderImportReport> {
  const { tenders, rejected } = parseTenderSheet(readSheetRows(file));
  const existing = await loadRelevanceState(
    tenders.map((t) => t.processNumber),
    database,
  );
  const wanted = tendersToClassify(tenders, existing);
  let verdicts: TenderVerdicts = new Map();
  try {
    verdicts = await classify(wanted);
  } catch (error) {
    console.error("tender classification failed; importing without verdicts", error);
  }
  const result = await importTenders(tenders, actorBdId, database, verdicts);
  const unclassified = wanted.filter((t) => !verdicts.has(tenderKey(t.processNumber))).length;
  return { ...result, rejected, unclassified };
}
