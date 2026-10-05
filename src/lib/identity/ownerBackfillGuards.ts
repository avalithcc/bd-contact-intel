/**
 * Pure guards shared by the owner backfill's two callers: the owner-run script
 * (scripts/backfill-owner-last-worked.ts) and the nightly cron
 * (src/app/api/owners/recompute/route.ts). No I/O, so every refusal rule is unit-testable.
 */
import type { OwnerBackfillPlan } from "@/lib/identity/ownerBackfillPlan";

/** Sanity cap for the owner-run script: the one-shot cleanup is a few hundred persons. */
export const OWNER_SCRIPT_MAX_CHANGES = 2000;

/**
 * Cap for the nightly cron. Steady state is a handful of changes per night
 * (only persons worked since the last run can move). A sudden spike means a
 * bad import or a rule bug, and that must page a human (non-2xx run) rather
 * than silently reassign hundreds of owners. This is only safe because the
 * initial cleanup (~279 changes) is applied beforehand by the owner's one-shot
 * script `--execute`.
 */
export const OWNER_CRON_MAX_CHANGES = 25;

/** Who triggered a run; stored in the audit row so a cron run is never read as a human action. */
export type OwnerBackfillTrigger = "manual" | "cron";

export type OwnerBackfillRunDecision = "nothing_to_do" | "apply" | "over_cap";

/** At the cap still applies; one over refuses. */
export function decideOwnerBackfillRun(plan: OwnerBackfillPlan, maxChanges: number): OwnerBackfillRunDecision {
  if (plan.changes.length === 0) return "nothing_to_do";
  return plan.changes.length > maxChanges ? "over_cap" : "apply";
}

export type CronActorResolution = { ok: true; bdId: string } | { ok: false; reason: "no_admin" | "multiple_admins" };

/** A cron has no human: it acts as THE admin, and refuses to guess when there is not exactly one. */
export function resolveCronActor(adminBdIds: readonly string[]): CronActorResolution {
  if (adminBdIds.length === 0) return { ok: false, reason: "no_admin" };
  if (adminBdIds.length > 1) return { ok: false, reason: "multiple_admins" };
  return { ok: true, bdId: adminBdIds[0]! };
}

export function buildOwnerBackfillAuditMetadata(
  plan: OwnerBackfillPlan,
  applied: OwnerBackfillPlan["changes"],
  trigger: OwnerBackfillTrigger,
  historySource: string,
) {
  return {
    trigger,
    planned: plan.changes.length,
    updated: applied.length,
    changedSinceRead: plan.changes.length - applied.length,
    byLastTouch: applied.filter((c) => c.basis === "last_touch").length,
    byEarliestConnection: applied.filter((c) => c.basis === "earliest_connection").length,
    unchanged: plan.unchanged,
    skippedManual: plan.skippedManual,
    historySource,
  };
}
