/** What the list needs from the newest document of a tender to say something about its budget. */
export interface BudgetCellInput {
  hasDocument: boolean;
  hasAnalysis: boolean;
  /** The stored flag; null when the analysis (or the flag) is absent. */
  economicsIncluded: boolean | null;
  /** Whether the stored economics object carries the `budgetAmount` key at all (absent = never asked, null = asked and not stated). */
  hasBudgetAmountKey: boolean;
  budgetAmount: string | null;
}

export type BudgetCell =
  | { state: "amount"; amount: string }
  | { state: "bidder_sets" }
  | { state: "reanalyse" }
  | { state: "no_pliego" };

/**
 * Four distinct facts, never conflated: an absent key means the model was never asked (re-analyse), a null value means it
 * looked and the pliego fixes no figure. A stored `economicsIncluded: true` from before the key existed is NOT enough: the
 * key itself must be there, the same rule toTenderAnalysis applies when it reads the block.
 */
export function budgetCellState(i: BudgetCellInput): BudgetCell {
  if (!i.hasDocument || !i.hasAnalysis) return { state: "no_pliego" };
  if (i.economicsIncluded !== true || !i.hasBudgetAmountKey) return { state: "reanalyse" };
  const amount = i.budgetAmount?.trim();
  return amount ? { state: "amount", amount } : { state: "bidder_sets" };
}
