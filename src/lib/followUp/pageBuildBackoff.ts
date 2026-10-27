/**
 * When the /follow-ups page may try to build today's queue (queueQueries.ts#getFollowUpQueuePage). Pure, so the decision is
 * unit-tested without a database. A built day is never rebuilt from the page; a FAILED build is retried on a later visit, but not
 * more than once per PAGE_BUILD_RETRY_MS, so a database that is down is not hit by the heavy selection on every visit.
 */
export const PAGE_BUILD_RETRY_MS = 5 * 60 * 1000;

export type PageBuildState = { status: "built" } | { status: "failed"; at: number };

export function shouldAttemptPageBuild(state: PageBuildState | undefined, nowMs: number): boolean {
  if (!state) return true;
  if (state.status === "built") return false;
  return nowMs - state.at >= PAGE_BUILD_RETRY_MS;
}
