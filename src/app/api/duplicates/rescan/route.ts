import { NextResponse } from "next/server";
import { isValidBearer } from "@/lib/cronAuth";
import { db } from "@/db";
import { resolveCronActor } from "@/lib/identity/ownerBackfillGuards";
import { readAdminBdIds } from "@/lib/identity/ownerBackfillRun";
import { clampRescanCap } from "@/lib/identity/duplicateRescan";
import { runDuplicateRescan } from "@/lib/identity/duplicateRescanRun";

/**
 * Daily re-scan of EXISTING live contacts for name+company collisions, creating
 * the `duplicate_candidate` rows write-time detection never proposed. Vercel
 * Cron (`30 6 * * *` UTC = 03:30 Buenos Aires, after the 03:00 owners recompute;
 * daily is the Hobby-plan granularity) or manually with the same bearer token.
 * Excluded from the session gate via src/lib/auth/sessionExemptRoutes.ts.
 *
 * Same code as the admin "Re-escanear" action (src/lib/identity/duplicateRescanRun.ts).
 * Cap: TRUNCATES, never refuses. At most `cap` (default 50, `?cap=N` up to 200)
 * pairs are created per run; the remainder is returned and stored in the audit
 * row, and left for the next run. Actor: THE single admin `bd` row, like
 * /api/owners/recompute (zero or several admins refuse a real run with a 500).
 * The audit row carries `trigger: "cron"`. `?dryRun=1` writes nothing, not even
 * an audit row. The body carries counts only, never person data.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<deployment>/api/duplicates/rescan?dryRun=1"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const cap = clampRescanCap(url.searchParams.get("cap"));

  const actor = resolveCronActor(await readAdminBdIds(db));
  if (!dryRun && !actor.ok) return NextResponse.json({ dryRun, refusal: actor.reason }, { status: 500 });

  const report = await runDuplicateRescan(db, { dryRun, trigger: "cron", actorBdId: actor.ok ? actor.bdId : "", cap });
  return NextResponse.json(report);
}
