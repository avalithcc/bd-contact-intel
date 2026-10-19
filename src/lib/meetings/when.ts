/**
 * How a meeting's date and time read on screen and in the 18:00 email. Everything is the Argentina calendar and clock
 * (fixed UTC-3, see src/lib/tasks/argentinaDate.ts), never the server's or the browser's. Pure: labels come from the caller.
 */
import { fillTemplate } from "@/lib/i18n/template";
import {
  ES_MONTH_ABBR,
  addDaysToDateString,
  argentinaCalendarDate,
  argentinaDateTimeParts,
} from "@/lib/tasks/argentinaDate";

export interface MeetingWhenLabels {
  today: string;
  yesterday: string;
  tomorrow: string;
  /** With an `{n}` placeholder. */
  agoMinutes: string;
  agoHours: string;
}

const ES_WEEKDAY_ABBR = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const two = (n: number) => String(n).padStart(2, "0");

/**
 * "mié 14 oct, 10:00": the date and time with no reference to "now", so a server render and a client render of the same
 * instant always agree (timeline cards). The year is left out, like the rest of the record page's dates.
 */
export function formatMeetingAbsolute(at: Date, opts: { weekday?: boolean } = {}): string {
  const { weekday = true } = opts;
  const p = argentinaDateTimeParts(at);
  const dow = ES_WEEKDAY_ABBR[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday ? `${dow} ` : ""}${p.day} ${ES_MONTH_ABBR[p.month - 1]}, ${two(p.hour)}:${two(p.minute)}`;
}

/**
 * `text` is the date and time ("hoy 11:00", "jue 22 oct, 15:00"); `ago` is the "hace 7 h" note, only for a time that already
 * passed today, so the caller can render it apart ("· hace 7 h").
 */
export function formatMeetingWhen(
  at: Date,
  now: Date,
  labels: MeetingWhenLabels,
  opts: { weekday?: boolean } = {},
): { text: string; ago: string | null } {
  const { weekday = true } = opts;
  const p = argentinaDateTimeParts(at);
  const time = `${two(p.hour)}:${two(p.minute)}`;
  const day = argentinaCalendarDate(at);
  const today = argentinaCalendarDate(now);

  let ago: string | null = null;
  let text: string;
  if (day === today) {
    text = `${labels.today} ${time}`;
    const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
    if (minutes >= 0) {
      ago = minutes < 60 ? fillTemplate(labels.agoMinutes, { n: String(minutes) }) : fillTemplate(labels.agoHours, { n: String(Math.floor(minutes / 60)) });
    }
  } else if (day === addDaysToDateString(today, -1)) {
    text = `${labels.yesterday} ${time}`;
  } else if (day === addDaysToDateString(today, 1)) {
    text = `${labels.tomorrow} ${time}`;
  } else {
    const dow = ES_WEEKDAY_ABBR[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
    const year = p.year === argentinaDateTimeParts(now).year ? "" : ` ${p.year}`;
    text = `${weekday ? `${dow} ` : ""}${p.day} ${ES_MONTH_ABBR[p.month - 1]}${year}, ${time}`;
  }
  return { text, ago };
}
