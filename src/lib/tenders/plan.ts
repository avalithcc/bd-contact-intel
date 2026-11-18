import { tenderKey, type TenderInput } from "./parse";

/** A tender row as stored: the portal's columns plus the row id. Triage and note are ours and never part of a plan. */
export interface StoredTender extends TenderInput {
  id: string;
}

export interface TenderImportPlan {
  create: TenderInput[];
  update: TenderInput[];
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

/** Pure: decides what an import must write. Reads `incoming` and `existing`, mutates neither. */
export function planTenderImport(incoming: readonly TenderInput[], existing: ReadonlyMap<string, TenderInput>): TenderImportPlan {
  const plan: TenderImportPlan = { create: [], update: [], unchanged: 0 };
  for (const tender of incoming) {
    const current = existing.get(tenderKey(tender.processNumber));
    if (!current) plan.create.push(tender);
    else if (sameTender(current, tender)) plan.unchanged += 1;
    else plan.update.push(tender);
  }
  return plan;
}
