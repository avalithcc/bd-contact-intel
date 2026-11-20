import test from "node:test";
import assert from "node:assert/strict";
import { budgetCellState } from "@/lib/tenders/budgetCell";

test("no document or no analysis is 'no pliego'", () => {
  assert.deepEqual(budgetCellState({ hasDocument: false, hasAnalysis: false, economicsIncluded: null, hasBudgetAmountKey: false, budgetAmount: null }), { state: "no_pliego" });
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: false, economicsIncluded: null, hasBudgetAmountKey: false, budgetAmount: null }), { state: "no_pliego" });
});

test("an analysis that predates the block says re-analyse, whether the flag or the key is what is missing", () => {
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: true, economicsIncluded: false, hasBudgetAmountKey: true, budgetAmount: null }), { state: "reanalyse" });
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: true, economicsIncluded: true, hasBudgetAmountKey: false, budgetAmount: null }), { state: "reanalyse" });
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: true, economicsIncluded: null, hasBudgetAmountKey: false, budgetAmount: null }), { state: "reanalyse" });
});

test("a complete analysis with no amount is 'the bidder fills it in', distinct from the other muted states", () => {
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: true, economicsIncluded: true, hasBudgetAmountKey: true, budgetAmount: null }), { state: "bidder_sets" });
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: true, economicsIncluded: true, hasBudgetAmountKey: true, budgetAmount: "  " }), { state: "bidder_sets" });
});

test("a known amount is shown as written", () => {
  assert.deepEqual(budgetCellState({ hasDocument: true, hasAnalysis: true, economicsIncluded: true, hasBudgetAmountKey: true, budgetAmount: "ARS 48.000.000" }), { state: "amount", amount: "ARS 48.000.000" });
});
