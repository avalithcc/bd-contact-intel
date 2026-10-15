/**
 * Text helpers for the Sequence detail view. The `sequences` dictionary slice is plain strings with `{name}`
 * placeholders (it crosses into client components, where the ClientStrings guard forbids functions), so substitution
 * lives here, once. Times are read in Miami: that is the clock the schedule and the runner use, whatever the viewer's.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import { addCalendarDays, miamiCalendarDate } from "./miamiTime";

export type SequenceLabels = ClientStrings<Dictionary["sequences"]>;

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** "20 min", "2 h", "4 d". At least 1 minute, so a just-now event never reads "0" or negative. */
export function agoText(date: Date, now: Date, l: Pick<SequenceLabels, "agoMinutes" | "agoHours" | "agoDays">): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return fill(l.agoMinutes, { n: minutes });
  if (minutes < 24 * 60) return fill(l.agoHours, { n: Math.floor(minutes / 60) });
  return fill(l.agoDays, { n: Math.floor(minutes / (24 * 60)) });
}

const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });

export function miamiWhen(date: Date, now: Date): { day: "today" | "tomorrow" | "other"; ddmm: string; hhmm: string } {
  const d = miamiCalendarDate(date);
  const today = miamiCalendarDate(now);
  const day = d === today ? "today" : d === addCalendarDays(today, 1) ? "tomorrow" : "other";
  return { day, ddmm: `${d.slice(8, 10)}/${d.slice(5, 7)}`, hhmm: clock.format(date) };
}
