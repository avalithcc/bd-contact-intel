/**
 * DB-FREE ON PURPOSE, like src/lib/prospecting/cronRun.ts: importing `@/db` here makes loading the module throw without a
 * DATABASE_URL, and the unit test only looks green when one happens to be set. The wiring lives in portalRunDeps.ts.
 *
 * The run behind /api/tenders/portal: refresh the public portal data of the open, relevant tenders. Strictly sequential and
 * polite to a government service (a pause between tenders). The route's maxDuration is 60s and one tender can take up to
 * PORTAL_TENDER_TIMEOUT_MS, so the run carries a wall-clock budget and stops STARTING tenders once it passes; what was not
 * reached is simply still stale and comes first next time. One tender's failure is recorded on its own row and never fails the run.
 */
import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import type { PortalOutcome } from "@/lib/tenders/portalFetch";

export type { PortalOutcome };

/** 60s route minus one tender already in flight at the deadline (15s timeout) and the last write. */
export const PORTAL_BUDGET_MS = 38_000;
/** A pause between tenders; none after the last. */
export const PORTAL_PAUSE_MS = 500;
/** Rows read per run: at roughly 2-3 seconds a tender the budget is the real limit, this only bounds the read. */
export const PORTAL_MAX_PER_RUN = 40;
/** A tender fetched more recently than this is skipped. */
export const PORTAL_REFRESH_HOURS = 12;

export interface PortalCandidate {
  id: string;
  processNumber: string;
}

export interface PortalRunDeps {
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The due tenders (at most `limit`, stalest first) and how many are due in total. */
  selectDue: (limit: number) => Promise<{ rows: PortalCandidate[]; total: number }>;
  /** Must not throw; a throw is still counted as that tender's failure. */
  fetchOne: (processNumber: string) => Promise<PortalOutcome>;
  save: (candidate: PortalCandidate, outcome: PortalOutcome, at: Date) => Promise<void>;
}

export interface PortalRunSummary {
  status: "ok";
  attempted: number;
  fetched: number;
  notFound: number;
  failed: number;
  stoppedEarly: boolean;
  leftForNextRun: number;
}

export async function runPortalFetch(deps: PortalRunDeps): Promise<PortalRunSummary> {
  const deadline = deps.clock() + PORTAL_BUDGET_MS;
  const { rows, total } = await deps.selectDue(PORTAL_MAX_PER_RUN);
  const s = { attempted: 0, fetched: 0, notFound: 0, failed: 0 };
  let stoppedEarly = false;

  for (const candidate of rows) {
    if (deps.clock() >= deadline) {
      stoppedEarly = true;
      break;
    }
    if (s.attempted > 0) await deps.sleep(PORTAL_PAUSE_MS);
    s.attempted++;
    let outcome: PortalOutcome;
    try {
      outcome = await deps.fetchOne(candidate.processNumber);
    } catch (err) {
      outcome = { kind: "error", message: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
    }
    try {
      await deps.save(candidate, outcome, new Date(deps.clock()));
      if (outcome.kind === "ok") s.fetched++;
      else if (outcome.kind === "not_found") s.notFound++;
      else s.failed++;
    } catch {
      s.failed++;
    }
  }
  return { status: "ok", ...s, stoppedEarly, leftForNextRun: Math.max(0, total - s.attempted) };
}

/** Auth first: a wrong or missing bearer gets a 401 and `run` is never called. */
export async function handlePortalRequest(request: Request, o: { secret: string | undefined; run: () => Promise<PortalRunSummary> }): Promise<Response> {
  if (!isValidBearer(request.headers.get("authorization"), o.secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await o.run());
}
