/**
 * Required-order gate for `--phase=catch_up` (design.md "Catch-up (owner
 * D4b)": required order is collapse execute → fold_leads execute → catch_up
 * — see this file's caller in scripts/unify-contacts.ts). Pure — no DB
 * access, so callers supply the already-fetched latest EXECUTED run of each
 * kind (src/lib/migration/queries.ts#getLatestExecutedMigrationRun).
 *
 * `fold_leads` deliberately does NOT go through this guard: after
 * queries.ts's anti-join fix (readUnmappedLeadRowsForFold), fold_leads is
 * safe to run at any point — including after the live dual-write cutover is
 * deployed, or after a catch-up has already mapped some leads — so it must
 * not be blocked on catch-up having run.
 */
export type PhaseOrderBlockReason = "collapse_not_executed" | "fold_leads_not_executed";

export class PhaseOrderBlockedError extends Error {
  constructor(public readonly reason: PhaseOrderBlockReason) {
    super(
      reason === "collapse_not_executed"
        ? "catch_up refused: the collapse migration has not been executed yet " +
          "(run `--phase=collapse --execute --run=<id>` first)."
        : "catch_up refused: the fold_leads migration has not been executed yet " +
          "(run `--phase=fold_leads --execute --run=<id>` first).",
    );
    this.name = "PhaseOrderBlockedError";
  }
}

export interface PhaseOrderRun {
  executedAt: Date | null;
}

/**
 * Throws unless BOTH `collapseRun` and `foldLeadsRun` are runs that have
 * actually executed (`mode=execute` + `executedAt` set) — not merely a dry
 * run or an approved-but-unexecuted run. Checks collapse first: a missing
 * fold_leads run is meaningless to report while collapse itself never ran.
 */
export function assertCatchUpPhaseOrderAllowed(
  collapseRun: PhaseOrderRun | null,
  foldLeadsRun: PhaseOrderRun | null,
): void {
  if (!collapseRun?.executedAt) throw new PhaseOrderBlockedError("collapse_not_executed");
  if (!foldLeadsRun?.executedAt) throw new PhaseOrderBlockedError("fold_leads_not_executed");
}
