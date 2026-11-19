/**
 * DB-FREE ON PURPOSE. This module imported `@/db` at the top, so loading it threw "DATABASE_URL is not set" and the
 * unit test could not run at all - it only looked green because it was run with a database URL in the environment.
 * The wiring lives in realDeps.ts; this file stays pure so the budget and auth logic are testable without a database,
 * the same split plan.ts and consumer.ts already use.
 */
/**
 * The daily auto-prospecting run behind /api/prospecting/run: the same producer and consumer scripts/auto-prospecting.ts runs by hand.
 *
 * Time: the route's maxDuration is 60s and the consumer makes one model call per draft, so the run carries a wall-clock budget
 * (AUTO_PROSPECTING_BUDGET_MS) and the consumer stops STARTING signals once it passes. Stopping is safe and resumable: nothing is
 * claimed until a signal's outcome is written in one transaction, so what was not reached is simply still unconsumed.
 *
 * A cron has no human, so it acts as THE single admin (same rule as /api/owners/recompute) and refuses to guess otherwise. An idle run
 * (no BD with the switch on) does no work at all; a run that wrote anything leaves one audit_log row with the counts.
 */
import { NextResponse } from "next/server";
import type { ConsumeSummary } from "@/lib/prospecting/consumer";
import { isValidBearer } from "@/lib/cronAuth";
import { resolveCronActor } from "@/lib/identity/ownerBackfillGuards";

export const AUTO_PROSPECTING_RUN_ACTION = "auto_prospecting_run";
/**
 * Under the route's 60s with room for ONE draft already in flight when the deadline passes (a model call is several seconds and cannot
 * be interrupted), plus the producer and the audit write.
 */
export const AUTO_PROSPECTING_BUDGET_MS = 45_000;

export interface CronDeps {
  clock: () => number;
  anyBdEnabled: () => Promise<boolean>;
  readAdminBdIds: () => Promise<string[]>;
  produce: (actorBdId: string) => Promise<string[]>;
  consume: (opts: { deadlineMs: number; clock: () => number }) => Promise<ConsumeSummary>;
  audit: (actorBdId: string, metadata: Record<string, unknown>) => Promise<void>;
}

export type CronResult =
  | { status: "noop"; reason: "no_bd_enabled"; modelCalls: 0 }
  | { status: "refused"; reason: "no_admin" | "multiple_admins" }
  | ({ status: "ok"; signalsProduced: number } & ConsumeSummary);

export async function runAutoProspectingCron(deps: CronDeps): Promise<CronResult> {
  const deadlineMs = deps.clock() + AUTO_PROSPECTING_BUDGET_MS;
  if (!(await deps.anyBdEnabled())) return { status: "noop", reason: "no_bd_enabled", modelCalls: 0 };
  const actor = resolveCronActor(await deps.readAdminBdIds());
  if (!actor.ok) return { status: "refused", reason: actor.reason };

  const produced = await deps.produce(actor.bdId);
  const summary = await deps.consume({ deadlineMs, clock: deps.clock });
  if (produced.length + summary.drafted + summary.refused > 0) {
    // Revert: the drafts are listed by prospect_draft (see consumer.ts recordOutcome); this row carries counts only.
    const { stoppedEarly, leftForNextRun, drafted, refused, deferred, failed, byReason } = summary;
    await deps.audit(actor.bdId, { trigger: "cron", signalsProduced: produced.length, drafted, refused, deferred, failed, stoppedEarly, leftForNextRun, byReason });
  }
  return { status: "ok", signalsProduced: produced.length, ...summary };
}

/** Auth first: a wrong or missing bearer gets a 401 and `run` is never called. 500 when the run refused, so the scheduler sees it. */
export async function handleAutoProspectingRequest(request: Request, o: { secret: string | undefined; run: () => Promise<CronResult> }): Promise<Response> {
  if (!isValidBearer(request.headers.get("authorization"), o.secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await o.run();
  return NextResponse.json(result, { status: result.status === "refused" ? 500 : 200 });
}
