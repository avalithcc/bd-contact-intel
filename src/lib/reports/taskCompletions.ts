/**
 * Pure twin of buildReportPerBdQuery's `rpt_task_completions`/
 * `rpt_tasks_pivot` CTEs (src/lib/reports/queries.ts) — pins the "Tareas
 * completadas" rule with plain fixtures, no DB. The SQL does the actual
 * aggregation (round-trip discipline, PERFORMANCE.md); this module exists
 * only so the rule itself — latest completion per task wins, and only a
 * task CURRENTLY 'done' counts — is unit-tested independently of a live
 * Postgres connection, same convention as deriveStatus.ts's
 * pickLaterDiscard/pickHigherStage reducers.
 */

export interface TaskCompletionCandidate {
  taskId: string;
  completedAt: Date;
}

/**
 * Picks the later of two completion candidates for the SAME task — mirrors
 * the SQL's `distinct on (task.id) ... order by task.id, activity.created_at
 * desc`. A task completed, reopened, and completed again must count its
 * LATEST completion only, never double-count or count a stale one.
 */
export function pickLatestCompletion(
  a: TaskCompletionCandidate | null,
  b: TaskCompletionCandidate,
): TaskCompletionCandidate {
  if (!a) return b;
  return b.completedAt >= a.completedAt ? b : a;
}

/**
 * A completion only counts toward "Tareas completadas" if the task it
 * belongs to is CURRENTLY 'done' — mirrors the SQL's `where task.status =
 * 'done'` filter. A task later reopened contributes nothing at all
 * (README decision 9: "did the BD close things out", not "did the BD ever
 * mark it done at some point").
 */
export function isCompletionCountable(currentTaskStatus: string): boolean {
  return currentTaskStatus === "done";
}
