import { addDaysToDateString, argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

/**
 * Default due date (`YYYY-MM-DD`, the value of an `<input type="date">`) for
 * the follow-up task created from the note box: tomorrow's calendar day in
 * Argentina. Every task `due_at` is a bare calendar date, so the day is read
 * off the Argentina clock, never the UTC one.
 */
export function defaultFollowUpDueDate(now: Date): string {
  return addDaysToDateString(argentinaCalendarDate(now), 1);
}
