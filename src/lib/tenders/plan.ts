import type { TenderVerdict } from "./classify";
import { tenderKey, type TenderInput } from "./parse";

/** A tender row as stored: the portal's columns plus the row id. Triage and note are ours and never part of a plan. */
export interface StoredTender extends TenderInput {
  id: string;
  aiRelevant: boolean | null;
  relevanceOverride: boolean | null;
}

export interface TenderImportPlan {
  create: TenderInput[];
  update: TenderInput[];
  /** Portal columns identical, but the model just classified it: only the verdict is written. Counted in `unchanged` too. */
  verdictOnly: TenderInput[];
  unchanged: number;
}

/** The one place the lookup map is built; the planner reads it through the same `tenderKey`. */
export function indexTendersByKey<T extends { processNumber: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [tenderKey(r.processNumber), r]));
}

const SAME_COLUMNS = [
  "fileNumber",
  "name",
  "processType",
  "portalStatus",
  "executingUnit",
  "financialAdminService",
] as const satisfies readonly (keyof TenderInput)[];

function sameTender(a: TenderInput, b: TenderInput): boolean {
  return a.openingAt.getTime() === b.openingAt.getTime() && SAME_COLUMNS.every((c) => a[c] === b[c]);
}

/** Pure: decides what an import must write. Reads `incoming`, `existing` and `verdicts` (keyed by tenderKey), mutates none. */
export function planTenderImport(
  incoming: readonly TenderInput[],
  existing: ReadonlyMap<string, TenderInput>,
  verdicts: ReadonlyMap<string, TenderVerdict> = new Map(),
): TenderImportPlan {
  const plan: TenderImportPlan = { create: [], update: [], verdictOnly: [], unchanged: 0 };
  for (const tender of incoming) {
    const current = existing.get(tenderKey(tender.processNumber));
    if (!current) plan.create.push(tender);
    else if (sameTender(current, tender)) {
      plan.unchanged += 1;
      if (verdicts.has(tenderKey(tender.processNumber))) plan.verdictOnly.push(tender);
    } else plan.update.push(tender);
  }
  return plan;
}
