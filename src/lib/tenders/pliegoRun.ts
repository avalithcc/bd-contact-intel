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

/**
 * Cooldowns of a tender whose last pliego attempt did not succeed, kept apart on purpose.
 * ABSENT (the portal has no Clausulas Particulares row, or does not list the process): a state of the world that changes slowly,
 * organisms publish the pliego days after the convocatoria, so it is retried, but only once a day.
 * FAILURE (network, timeout, not a PDF, oversized, store error): transient or a portal change, so a blip costs 2 hours, not a day.
 */
export const PLIEGO_RETRY_ABSENT_HOURS = 24;
export const PLIEGO_RETRY_FAILURE_HOURS = 2;
/** `tender_portal.pliego_error` values that mean "the pliego is not there (yet)", as opposed to a failed attempt. */
export const PLIEGO_ABSENT_ERRORS = ["no_document", "not_found"] as const;

/** What `pliego_error` records for an outcome that brought no file. Failure messages are prefixed so they can never equal an absent value. */
export function pliegoErrorFor(outcome: Exclude<PliegoOutcome, { kind: "ok" }>): string {
  if (outcome.kind === "error") return `error: ${outcome.message}`.slice(0, 200);
  return outcome.kind;
}

export interface PliegoCandidate {
  id: string;
  processNumber: string;
}

export interface PliegoRunDeps {
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Resolves who the documents are uploaded as, and whether storage is configured. */
  prepare: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Open, relevant tenders with no tender_document row and out of cooldown (at most `limit`), how many there are in total, and how many are cooling down. */
  selectDue: (limit: number) => Promise<{ rows: PliegoCandidate[]; total: number; cooling: number }>;
  /** Stamps the attempt: `error` null = success. Upserts, because a tender the portal job has not reached has no row. */
  record: (candidate: PliegoCandidate, error: string | null, at: Date) => Promise<void>;
  /** Must not throw; a throw is still counted as that tender's failure. */
  fetchOne: (processNumber: string) => Promise<PliegoOutcome>;
  /** "skipped" when a document appeared meanwhile: nothing is written and the stored file is removed. */
  store: (candidate: PliegoCandidate, file: { bytes: Uint8Array; filename: string }) => Promise<"stored" | "skipped">;
}

export type PliegoRunSummary =
  | { status: "ok"; attempted: number; downloaded: number; skipped: number; notFound: number; failed: number; skippedCooldown: number; stoppedEarly: boolean; leftForNextRun: number }
  | { status: "refused"; reason: string };

export async function runPliegoDownload(deps: PliegoRunDeps): Promise<PliegoRunSummary> {
  const deadline = deps.clock() + PLIEGO_BUDGET_MS;
  const ready = await deps.prepare();
  if (!ready.ok) return { status: "refused", reason: ready.reason };
  const { rows, total, cooling } = await deps.selectDue(PLIEGO_MAX_PER_RUN);
  const s = { attempted: 0, downloaded: 0, skipped: 0, notFound: 0, failed: 0 };
  let stoppedEarly = false;
  /** A bookkeeping failure never fails the run: the tender is simply tried again next time. */
  const record = async (c: PliegoCandidate, error: string | null) => {
    try {
      await deps.record(c, error, new Date(deps.clock()));
    } catch {}
  };

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
      await record(candidate, pliegoErrorFor(outcome));
      continue;
    }
    if (outcome.kind !== "ok") {
      s.failed++;
      await record(candidate, pliegoErrorFor(outcome));
      continue;
    }
    try {
      if ((await deps.store(candidate, { bytes: outcome.bytes, filename: outcome.filename })) === "stored") s.downloaded++;
      else s.skipped++;
      await record(candidate, null);
    } catch (err) {
      s.failed++;
      await record(candidate, pliegoErrorFor({ kind: "error", message: `store: ${err instanceof Error ? err.message : String(err)}` }));
    }
  }
  return { status: "ok", ...s, skippedCooldown: cooling, stoppedEarly, leftForNextRun: Math.max(0, total - s.attempted) };
}

/** Auth first: a wrong or missing bearer gets a 401 and `run` is never called. 500 when the run refused, so the caller sees it. */
export async function handlePliegoRequest(request: Request, o: { secret: string | undefined; run: () => Promise<PliegoRunSummary> }): Promise<Response> {
  if (!isValidBearer(request.headers.get("authorization"), o.secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await o.run();
  return NextResponse.json(result, { status: result.status === "refused" ? 500 : 200 });
}
