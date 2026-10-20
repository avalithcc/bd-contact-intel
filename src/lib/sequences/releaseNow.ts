/**
 * "Enviar ahora": an immediate release attempt for the members the BD just approved, so they do not wait for the next
 * tick of the minute cron. It is the SAME runner (runSequenceRelease) over the same ports, only narrowed to those members
 * and to the BD's own Sequences: the pre-send checks, the daily cap and the at-most-once claim all apply, and a member that
 * is not due, not approved or over the cap simply stays approved. Nothing sends from the server action itself.
 *
 * This is the one library entry the server actions may use to reach the runner; tests/unit/sequencesInert.test.ts pins it as
 * the only file besides the cron route that imports the runner.
 */
import { scopedRunnerPorts } from "./releaseQueries";
import { runSequenceRelease, type RunnerPorts, type RunSummary } from "./runSequenceRelease";

export function releaseMembersNow(ownerBdId: string, memberIds: readonly string[], overrides: Partial<RunnerPorts> = {}): Promise<RunSummary> {
  return runSequenceRelease({ ...scopedRunnerPorts({ memberIds, ownerBdId }), ...overrides });
}
