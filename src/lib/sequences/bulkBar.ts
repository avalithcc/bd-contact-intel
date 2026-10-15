/**
 * What the bulk bar shows for the current selection. The reviewed counter and the approve gate come from
 * `bulkApprovalGate` (the rule the server re-runs on rows it read itself); this only adds what the bar needs to draw.
 * Derived from the selection passed in, never from a page or a filtered list, so the counter cannot disagree with it.
 */
import { bulkApprovalGate, type GateRow } from "./bulkApprovalGate";

export type BulkBarView = { visible: boolean; selected: number; reviewed: number; approveEnabled: boolean; allReviewed: boolean; ids: string[] };

export function bulkBarView(selection: readonly GateRow[]): BulkBarView {
  const gate = bulkApprovalGate(selection);
  const ids = [...new Set(selection.map((r) => r.id))];
  return { visible: gate.total > 0, selected: gate.total, reviewed: gate.reviewed, approveEnabled: gate.enabled, allReviewed: gate.total > 0 && gate.reviewed === gate.total, ids };
}
