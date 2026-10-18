/**
 * Pure defaults of the "Más detalles…" call dialog (click-to-call-log, option b):
 * it opens at "now" on the Argentina wall clock, like every other date/time the
 * app shows, with a follow-up task three days out.
 */
import { addDaysToDateString, argentinaCalendarDate, argentinaDateTimeParts } from "@/lib/tasks/argentinaDate";

export const CALL_FOLLOW_UP_DAYS = 3;

const two = (n: number) => String(n).padStart(2, "0");

export function callDialogDefaults(now: Date): { date: string; time: string; followUpDue: string } {
  const p = argentinaDateTimeParts(now);
  const date = argentinaCalendarDate(now);
  return { date, time: `${two(p.hour)}:${two(p.minute)}`, followUpDue: addDaysToDateString(date, CALL_FOLLOW_UP_DAYS) };
}

export function followUpTitle(template: string, name: string): string {
  return template.replace("{name}", name);
}
