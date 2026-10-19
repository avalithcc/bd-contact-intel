/**
 * Pure rules of the shared "Enviar ahora / Programar…" control (contact composer and Sequences): the typed time, the
 * 15-minute list, the presets and which slots can be picked. Everything the BD types or sees is Argentina wall-clock time
 * (the CRM's base zone); the instant is derived with `argentinaWallClockToUtc`, the same function the server uses to read
 * the value back. No React, no clock of its own (callers pass `now`), so the server and the tests can use it.
 */
import { MAX_LEAD_MS, MIN_LEAD_MS } from "@/lib/scheduledEmail/plan";
import { addDaysToDateString, argentinaCalendarDate, argentinaWallClockToUtc } from "@/lib/tasks/argentinaDate";

/** A moment as the BD sees it: an Argentina calendar date and a 24-hour clock. */
export interface Slot {
  date: string;
  time: string;
}

export type SlotState = "ok" | "invalid_time" | "past" | "too_soon" | "too_far";

const ART_OFFSET_MS = 3 * 60 * 60 * 1000;
const QUARTER_MS = 15 * 60_000;
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "9:30", "930", "0930", "21" -> "HH:MM"; null for anything that is not a clock time. */
export function parseTimeInput(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t) ?? /^(\d{1,2})()$/.exec(t);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "00:00" ... "23:45". */
export function quarterHourOptions(): string[] {
  return Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
}

/** The Argentina date and clock an instant reads as. */
export function slotOf(instant: Date): Slot {
  const wall = new Date(instant.getTime() - ART_OFFSET_MS).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

/** The instant a slot means, or null when the date or time is not real (2026-13-40, 25:00). */
export function slotInstant(slot: Slot): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || !/^\d{2}:\d{2}$/.test(slot.time)) return null;
  const instant = argentinaWallClockToUtc(slot.date, slot.time);
  if (Number.isNaN(instant.getTime())) return null;
  const back = slotOf(instant);
  return back.date === slot.date && back.time === slot.time ? instant : null;
}

/** The three shortcuts, all in Argentina time: in one hour (rounded up to the quarter), tomorrow 9:00, next Monday 9:00. */
export function schedulePresets(now: Date): { hour: Slot; tomorrow: Slot; monday: Slot } {
  const today = argentinaCalendarDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const inOneHour = new Date(Math.ceil((now.getTime() + 60 * 60_000) / QUARTER_MS) * QUARTER_MS);
  return {
    hour: slotOf(inOneHour),
    tomorrow: { date: addDaysToDateString(today, 1), time: "09:00" },
    monday: { date: addDaysToDateString(today, (8 - weekday) % 7 || 7), time: "09:00" },
  };
}

/**
 * Whether a slot can be picked: not in the past, at least the minimum lead ahead and not beyond the maximum. The same
 * function disables options in the popover and re-checks on the server, so they cannot disagree. Which hour it is
 * (early, weekend, Miami floor) is deliberately NOT a rule here: explicit choices are respected.
 */
export function slotState(slot: Slot, ctx: { now: Date }): SlotState {
  const instant = slotInstant(slot);
  if (!instant) return "invalid_time";
  const lead = instant.getTime() - ctx.now.getTime();
  if (lead <= 0) return "past";
  if (lead < MIN_LEAD_MS) return "too_soon";
  if (lead > MAX_LEAD_MS) return "too_far";
  return "ok";
}

/** "jue 22 oct a las 10:00" (the popover's summary line; the clock has no leading zero in the hour). */
export function summaryLine(slot: Slot): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m! - 1]} a las ${Number(slot.time.slice(0, 2))}:${slot.time.slice(3)}`;
}
