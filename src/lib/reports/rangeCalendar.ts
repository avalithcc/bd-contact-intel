/**
 * Pure logic of the report range calendar (PeriodPicker.tsx): the Monday-first month grid, which days can be picked, how two
 * clicks become a range, keyboard movement and Spanish labels. Days are ART calendar dates ("YYYY-MM-DD"); nothing here touches
 * `Date` in the local zone. Kept out of the component so the server and the tests can use it (a "use client" module's
 * non-component exports are unreachable from server code).
 */
import { addDaysToDateString } from "@/lib/tasks/argentinaDate";
import { MAX_CUSTOM_DAYS } from "@/lib/reports/period";

export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const DOW_SHORT = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export interface DaySelection {
  start: string | null;
  end: string | null;
}

function parts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDay(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function daysBetween(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** The month as grid cells, Monday first: leading nulls up to the first day, trailing nulls to complete the last week. */
export function monthCells(y: number, m: number): (string | null)[] {
  const lead = ((new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(toDay(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function shiftMonth(ym: { y: number; m: number }, delta: number): { y: number; m: number } {
  const index = ym.y * 12 + (ym.m - 1) + delta;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** A day is not pickable when it is after today or, once a first day is chosen, more than MAX_CUSTOM_DAYS away from it. */
export function isDayDisabled(day: string, today: string, anchor: string | null): boolean {
  if (day > today) return true;
  return anchor !== null && Math.abs(daysBetween(anchor, day)) > MAX_CUSTOM_DAYS;
}

/** One click: starts a range, completes it (ordered, one day allowed) or, on a finished range, starts over. */
export function pickDay(sel: DaySelection, day: string): DaySelection {
  if (sel.start === null || sel.end !== null) return { start: day, end: null };
  return day < sel.start ? { start: day, end: sel.start } : { start: sel.start, end: day };
}

/** Keyboard movement on the grid; the result never passes today. */
export function moveDay(day: string, key: string, today: string): string {
  let next = day;
  switch (key) {
    case "ArrowLeft":
      next = addDaysToDateString(day, -1);
      break;
    case "ArrowRight":
      next = addDaysToDateString(day, 1);
      break;
    case "ArrowUp":
      next = addDaysToDateString(day, -7);
      break;
    case "ArrowDown":
      next = addDaysToDateString(day, 7);
      break;
    case "PageUp":
    case "PageDown": {
      const { y, m, d } = parts(day);
      const target = shiftMonth({ y, m }, key === "PageUp" ? -1 : 1);
      next = toDay(target.y, target.m, Math.min(d, daysInMonth(target.y, target.m)));
      break;
    }
  }
  return next > today ? today : next;
}

export type DayState = "start" | "end" | "single" | "in" | "preview" | null;

/** How a day is drawn: an end of the range, between the ends, part of the hover preview (second click pending), or plain. */
export function dayState(day: string, sel: DaySelection, hover: string | null): DayState {
  if (sel.start === null) return null;
  if (sel.end !== null) {
    if (sel.start === sel.end && day === sel.start) return "single";
    if (day === sel.start) return "start";
    if (day === sel.end) return "end";
    return day > sel.start && day < sel.end ? "in" : null;
  }
  if (day === sel.start) return hover !== null && hover > sel.start ? "start" : "single";
  if (hover === null || hover <= sel.start) return null;
  if (day === hover) return "end";
  return day > sel.start && day < hover ? "preview" : null;
}

/** "1 oct – 19 oct 2026"; without an end, "1 oct – …". */
export function describeRange(start: string, end: string | null): string {
  const a = parts(start);
  if (end === null) return `${a.d} ${MONTH_ABBR[a.m - 1]} – …`;
  const b = parts(end);
  const aText = `${a.d} ${MONTH_ABBR[a.m - 1]}${a.y === b.y ? "" : ` ${a.y}`}`;
  return `${aText} – ${b.d} ${MONTH_ABBR[b.m - 1]} ${b.y}`;
}

/** Accessible name of a day cell: "lunes 19 de octubre de 2026". */
export function dayLabel(day: string): string {
  const { y, m, d } = parts(day);
  return `${WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} de ${MONTH_NAMES[m - 1]} de ${y}`;
}
