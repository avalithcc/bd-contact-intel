import { liveRunnerPorts } from "@/lib/sequences/releaseQueries";
import { handleRunRequest } from "@/lib/sequences/runHandler";
import { runSequenceRelease } from "@/lib/sequences/runSequenceRelease";

/**
 * Releases approved Sequence emails (outreach-sequences, design D9). Triggered by the two daily Vercel crons in
 * vercel.json (13:00 and 14:00 UTC, so one of them lands at 09:00 Miami whichever side of daylight saving it is) with
 * the same bearer convention as src/app/api/tasks/digest/route.ts. Session-exempt in src/lib/auth/sessionExemptRoutes.ts;
 * authenticated only by CRON_SECRET, so no signed-in user can trigger it.
 *
 * The decisions live in src/lib/sequences/runHandler.ts (auth, status codes, and the log of the whole RunSummary, which
 * is the only place the `capped` and `lost` signals are read).
 *
 * To trigger a real run manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-deployment>/api/sequences/run
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return handleRunRequest(request, {
    secret: process.env.CRON_SECRET,
    run: () => runSequenceRelease(liveRunnerPorts),
    log: (level, entry) => console[level](JSON.stringify(entry)),
  });
}
