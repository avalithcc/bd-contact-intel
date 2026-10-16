// The pure half of the admin "Lusha por BD" report: which period is shown, and how the raw SQL rows become numbers and dates.
// No DB here (usageReportDb queries, adminDb.ts). Raw `sql` rows arrive with strings for bigint aggregates and timestamps.

import { parseDbTimestamp } from "@/lib/db/timestamp";
import { addDaysToDateString, argentinaCalendarDate, argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";

export const REPORT_PERIODS = ["week", "month", "quarter"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const parseReportPeriod = (raw: string | undefined): ReportPeriod => REPORT_PERIODS.find((p) => p === raw) ?? "month";

export interface PeriodWindow {
  /** Real UTC instants: [start, end), the Argentina calendar period containing `now`. */
  start: Date;
  end: Date;
  /** Argentina calendar dates, for the "del 1 al 16" label. */
  firstDay: string;
  today: string;
}

const shiftMonths = (date: string, months: number): string => {
  const [y, m] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
};

/** Weeks start on Monday, quarters on Jan/Apr/Jul/Oct 1st, all in Argentina time (the same day the daily cap uses). */
export function periodWindow(period: ReportPeriod, now: Date): PeriodWindow {
  const today = argentinaCalendarDate(now);
  let firstDay: string;
  let next: string;
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    firstDay = addDaysToDateString(today, -((weekday + 6) % 7));
    next = addDaysToDateString(firstDay, 7);
  } else {
    const span = period === "month" ? 1 : 3;
    const monthIndex = Number(today.slice(5, 7)) - 1;
    firstDay = `${today.slice(0, 5)}${String(monthIndex - (monthIndex % span) + 1).padStart(2, "0")}-01`;
    next = shiftMonths(firstDay, span);
  }
  return { start: argentinaInstantBoundary(firstDay), end: argentinaInstantBoundary(next), firstDay, today };
}

type Stamp = Date | string;

/** One row of the report query, exactly as postgres-js returns it. */
export interface RawUsageRow {
  ur_bd_id: string;
  ur_name: string;
  ur_email: string;
  ur_role: string;
  ur_enabled: boolean;
  ur_created_at: Stamp;
  ur_charged: number | string;
  ur_pending: number | string;
  ur_emails: number | string;
  ur_phones: number | string;
  ur_rejections: number | string;
  ur_last_use: Stamp | null;
  ur_toggle_by: string | null;
  ur_toggle_at: Stamp | null;
}

export interface UsageRow {
  bdId: string;
  name: string;
  email: string;
  role: string;
  lushaEnabled: boolean;
  createdAt: Date;
  /** credits_charged: what Lusha actually billed in the period. */
  chargedCredits: number;
  /** Reserved but never charged (failed or unreported rows): they still count against the daily cap. */
  pendingCredits: number;
  emails: number;
  phones: number;
  rejections: number;
  /** All time, not just the period. */
  lastUseAt: Date | null;
  /** Who last flipped the switch, and when. */
  toggledByName: string | null;
  toggledAt: Date | null;
}

const date = (v: Stamp | null): Date | null => (v === null ? null : parseDbTimestamp(v));

export function mapUsageRow(r: RawUsageRow): UsageRow {
  return {
    bdId: r.ur_bd_id,
    name: r.ur_name,
    email: r.ur_email,
    role: r.ur_role,
    lushaEnabled: r.ur_enabled,
    createdAt: parseDbTimestamp(r.ur_created_at),
    chargedCredits: Number(r.ur_charged),
    pendingCredits: Number(r.ur_pending),
    emails: Number(r.ur_emails),
    phones: Number(r.ur_phones),
    rejections: Number(r.ur_rejections),
    lastUseAt: date(r.ur_last_use),
    toggledByName: r.ur_toggle_by,
    toggledAt: date(r.ur_toggle_at),
  };
}

export interface UsageTotals {
  bds: number;
  enabled: number;
  chargedCredits: number;
  pendingCredits: number;
  emails: number;
  phones: number;
  reveals: number;
  rejections: number;
}

/** Every BD counts, disabled ones included: their past consumption is real. */
export function summarizeUsage(rows: readonly UsageRow[]): UsageTotals {
  const sum = (pick: (r: UsageRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const emails = sum((r) => r.emails);
  const phones = sum((r) => r.phones);
  return { bds: rows.length, enabled: rows.filter((r) => r.lushaEnabled).length, chargedCredits: sum((r) => r.chargedCredits), pendingCredits: sum((r) => r.pendingCredits), emails, phones, reveals: emails + phones, rejections: sum((r) => r.rejections) };
}

const NEW_BD_DAYS = 14;

/** "Nueva": a BD that still wears the new-BD default. A BD that existed before 0047 was left enabled, so it is never new. */
export const isNewBd = (r: Pick<UsageRow, "lushaEnabled" | "toggledAt" | "createdAt">, now: Date): boolean =>
  !r.lushaEnabled && r.toggledAt === null && now.getTime() - r.createdAt.getTime() < NEW_BD_DAYS * 86_400_000;

export const shareOf = (credits: number, total: number): number => (total > 0 ? Math.round((credits / total) * 100) : 0);
