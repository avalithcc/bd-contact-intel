/**
 * Pure vencidas/hoy/próximas split for the /tasks view (mockup-parity 6.2 —
 * see page.tsx's original inline `dueStatus`). Extracted (task-essentials
 * bug fix, backlog item 3) because the "Todas abiertas" tab used to pass a
 * hardcoded `overdueTasks = []` instead of a real overdue query, so a
 * teammate's overdue task was never in the overdue bucket AND never in
 * today/upcoming either (dueBucketOf correctly classifies it as "overdue",
 * which neither of those buckets accepts) — it simply vanished from the
 * list. The fix is at the call site (page.tsx must fetch a real overdue set
 * for every view, not just "mine"); this module makes the bucketing itself
 * one tested, view-agnostic function instead of two copies of inline logic.
 */
import { addDaysToDateString, argentinaCalendarDate, taskDueDate } from "@/lib/tasks/argentinaDate";

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | null;

/**
 * Classifies `dueAt` by comparing calendar dates, not raw instants (bug fix,
 * production 2026-09-29): `dueAt` is a stored calendar date at 00:00 UTC,
 * never a real instant, so the old `Math.ceil((dueAt - now) / day)` ms diff
 * flipped a due-today task to "overdue" every evening once UTC rolled over,
 * hours before the ART calendar day actually ended (21:00 ART = 00:00 UTC
 * next day). `now`, by contrast, IS a real instant, so it's read through
 * `argentinaCalendarDate` (the ART shift) to get today's Argentina date.
 */
export function dueBucketOf(dueAt: Date | string | null, now: Date = new Date()): DueBucket {
  if (!dueAt) return null;
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  if (Number.isNaN(due.getTime())) return null;

  const dueDate = taskDueDate(due);
  const today = argentinaCalendarDate(now);
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate === addDaysToDateString(today, 1)) return "tomorrow";
  return "week";
}

export interface DueBucketable {
  id: string;
  dueAt: Date | string | null;
}

export interface TaskBuckets<T> {
  overdueTasks: T[];
  todayTasks: T[];
  upcomingTasks: T[];
}

/**
 * `overdueTasks` MUST be the result of a real overdue query for the active
 * view (getOverdueTasks for "mine", getAllOverdueTasks for "all") — never a
 * client-side filter of `openTasks`, since `openTasks` is capped at the
 * page's row limit and could miss overdue rows past that cutoff. This
 * function only decides where the REST of `openTasks` (today vs upcoming)
 * lands, skipping anything already counted as overdue so nothing shows up
 * twice. Never mutates either input array.
 */
export function buildTaskBuckets<T extends DueBucketable>(
  openTasks: readonly T[],
  overdueTasks: readonly T[],
  now: Date = new Date(),
): TaskBuckets<T> {
  const overdueIds = new Set(overdueTasks.map((t) => t.id));
  const todayTasks: T[] = [];
  const upcomingTasks: T[] = [];
  for (const t of openTasks) {
    if (overdueIds.has(t.id)) continue;
    const bucket = dueBucketOf(t.dueAt, now);
    if (bucket === "today") todayTasks.push(t);
    else upcomingTasks.push(t);
  }
  return { overdueTasks: [...overdueTasks], todayTasks, upcomingTasks };
}
