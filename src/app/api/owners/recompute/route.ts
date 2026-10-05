import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import { db } from "@/db";
import {
  decideOwnerBackfillRun,
  OWNER_CRON_MAX_CHANGES,
  resolveCronActor,
} from "@/lib/identity/ownerBackfillGuards";
import { applyOwnerBackfill, loadOwnerBackfill, readAdminBdIds } from "@/lib/identity/ownerBackfillRun";

/**
 * Nightly 03:00 America/Argentina/Buenos_Aires recompute of person owners
 * under the last-worked rule (src/lib/identity/ownerRule.ts), so the owner
 * does not drift after the one-shot backfill. Triggered by Vercel Cron
 * (`0 6 * * *` UTC, quiet window, clear of the 09:00, 07:00 Mon, 11:30 and
 * 12:00 UTC crons — see vercel.json) or manually with the same bearer token.
 * Excluded from the Supabase session gate in src/lib/supabase/middleware.ts's
 * CRON_ROUTES allowlist.
 *
 * It runs the SAME code as scripts/backfill-owner-last-worked.ts
 * (src/lib/identity/ownerBackfillRun.ts). A manual owner (history row
 * `ownerBdId` + source `edit`) is never touched.
 *
 * Actor: a cron has no human, so it acts as THE single `bd` row with
 * role 'admin'. Zero or several admins refuse the run (500); it never
 * guesses. Its audit_log row carries `trigger: "cron"` (the script writes
 * `trigger: "manual"`).
 *
 * Cap: refuses (500, nothing written) above OWNER_CRON_MAX_CHANGES changes
 * (src/lib/identity/ownerBackfillGuards.ts). A spike means a bad import or a
 * rule bug and must page a human, not execute. The initial ~279-change
 * cleanup is expected to be applied by the owner's one-shot `--execute`
 * BEFORE this cron is trusted, which is why the cap can be this tight.
 *
 * `?dryRun=1` (still gated by CRON_SECRET) reports counts and any refusal
 * without writing.
 *
 * Response status signals the scheduler, same rationale as the digest
 * route: 200 for "applied N" / "nothing to do" / a dry run, 500 when the run
 * refused (no or several admins, over the cap). A thrown error is a 500 too.
 * The body carries counts only, never person data.
 *
 * To trigger a real run manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-deployment>.vercel.app/api/owners/recompute
 * To preview without writing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://<your-deployment>.vercel.app/api/owners/recompute?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";

  const { plan } = await loadOwnerBackfill(db);
  const counts = {
    planned: plan.changes.length,
    unchanged: plan.unchanged,
    skippedManual: plan.skippedManual,
    cap: OWNER_CRON_MAX_CHANGES,
  };
  const decision = decideOwnerBackfillRun(plan, OWNER_CRON_MAX_CHANGES);
  const actor = resolveCronActor(await readAdminBdIds(db));

  // Refusals first: they are failures for the scheduler even when nothing is planned.
  const refusal = !actor.ok ? actor.reason : decision === "over_cap" ? "over_cap" : null;
  if (dryRun) return NextResponse.json({ dryRun, ...counts, decision, refusal });
  if (refusal) return NextResponse.json({ dryRun, ...counts, decision, refusal }, { status: 500 });
  if (decision === "nothing_to_do" || !actor.ok) return NextResponse.json({ dryRun, ...counts, decision, applied: 0 });

  const { applied } = await applyOwnerBackfill(db, plan, actor.bdId, "cron");
  return NextResponse.json({ dryRun, ...counts, decision, applied, changedSinceRead: plan.changes.length - applied });
}
