/**
 * DB-FREE ON PURPOSE, like portalRun.ts: the unit test must load without a DATABASE_URL. Wiring lives in pliegoRunDeps.ts.
 *
 * The run behind /api/tenders/pliegos: download the pliego of the open, relevant tenders that have NO document at all (one the
 * owner uploaded by hand is never touched, because such a tender is never selected and the store re-checks). Strictly sequential
 * with a pause between tenders, and a wall-clock budget: it stops STARTING a tender once the budget has passed. One tender's
 * failure is counted and never fails the run. It only downloads and stores; it does not read the document.
 */
import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import type { PliegoOutcome } from "@/lib/tenders/pliegoFetch";

export type { PliegoOutcome };

/** 60s route minus one tender in flight at the deadline (PLIEGO_TENDER_TIMEOUT_MS = 22s) and its upload. */
export const PLIEGO_BUDGET_MS = 25_000;
/** Longer than the portal refresh's pause: every tender here moves a whole file off a public service. */
export const PLIEGO_PAUSE_MS = 1_500;
export const PLIEGO_MAX_PER_RUN = 20;

export interface PliegoCandidate {
  id: string;
  processNumber: string;
}

export interface PliegoRunDeps {
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Resolves who the documents are uploaded as, and whether storage is configured. */
  prepare: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Open, relevant tenders with no tender_document row (at most `limit`) and how many there are in total. */
  selectDue: (limit: number) => Promise<{ rows: PliegoCandidate[]; total: number }>;
  /** Must not throw; a throw is still counted as that tender's failure. */
  fetchOne: (processNumber: string) => Promise<PliegoOutcome>;
  /** "skipped" when a document appeared meanwhile: nothing is written and the stored file is removed. */
  store: (candidate: PliegoCandidate, file: { bytes: Uint8Array; filename: string }) => Promise<"stored" | "skipped">;
}

export type PliegoRunSummary =
  | { status: "ok"; attempted: number; downloaded: number; skipped: number; notFound: number; failed: number; stoppedEarly: boolean; leftForNextRun: number }
  | { status: "refused"; reason: string };

export async function runPliegoDownload(deps: PliegoRunDeps): Promise<PliegoRunSummary> {
  const deadline = deps.clock() + PLIEGO_BUDGET_MS;
  const ready = await deps.prepare();
  if (!ready.ok) return { status: "refused", reason: ready.reason };
  const { rows, total } = await deps.selectDue(PLIEGO_MAX_PER_RUN);
  const s = { attempted: 0, downloaded: 0, skipped: 0, notFound: 0, failed: 0 };
  let stoppedEarly = false;

  for (const candidate of rows) {
    if (deps.clock() >= deadline) {
      stoppedEarly = true;
      break;
    }
    if (s.attempted > 0) await deps.sleep(PLIEGO_PAUSE_MS);
    s.attempted++;
    let outcome: PliegoOutcome;
    try {
      outcome = await deps.fetchOne(candidate.processNumber);
    } catch (err) {
      outcome = { kind: "error", message: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
    }
    if (outcome.kind === "not_found" || outcome.kind === "no_document") {
      s.notFound++;
      continue;
    }
    if (outcome.kind !== "ok") {
      s.failed++;
      continue;
    }
    try {
      if ((await deps.store(candidate, { bytes: outcome.bytes, filename: outcome.filename })) === "stored") s.downloaded++;
      else s.skipped++;
    } catch {
      s.failed++;
    }
  }
  return { status: "ok", ...s, stoppedEarly, leftForNextRun: Math.max(0, total - s.attempted) };
}

/** Auth first: a wrong or missing bearer gets a 401 and `run` is never called. 500 when the run refused, so the caller sees it. */
export async function handlePliegoRequest(request: Request, o: { secret: string | undefined; run: () => Promise<PliegoRunSummary> }): Promise<Response> {
  if (!isValidBearer(request.headers.get("authorization"), o.secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await o.run();
  return NextResponse.json(result, { status: result.status === "refused" ? 500 : 200 });
}
