/**
 * Pure planner for the "connect your Gmail" reminder email (gmail-reminder-email). Decides, per BD, whether today's run sends
 * reminder #1, #2 or #3, and whether the owner is told. No I/O: the route reads the rows and sends; this only decides.
 *
 * A BD qualifies when its Gmail is in a state the RED reconnect banner reports (`isGmailUnhealthy`, which delegates to
 * decideConnectionBanner so the two can never drift) and it is not an admin or an excluded account. A "series" is the
 * reminders sent AFTER the BD was last seen: coming back ends it, and a later absence starts a fresh one.
 *   #1: last seen 2+ days ago, none yet in the series.   #2 and #3: 3+ days after the previous one.   Max 3 per series.
 * Thresholds count BUSINESS days: Mon-Fri on the Argentina calendar, no holiday calendar. The cron runs weekdays only, and
 * with calendar days a BD last seen Friday afternoon would be reminded Monday 09:00, before opening the CRM. Comparing whole
 * days (not raw milliseconds) also keeps a send time that drifts by seconds from pushing a due reminder back a day.
 * #3 also asks the route to tell the owner.
 */
import { decideConnectionBanner, type ConnectionBannerAccount } from "./connectionBanner";
import { addDaysToDateString, argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

export const FIRST_REMINDER_AFTER_DAYS = 2;
export const REMINDER_SPACING_DAYS = 3;
export const MAX_REMINDERS_PER_SERIES = 3;

export interface ReminderCandidate {
  bdId: string;
  role: string;
  /** Test/e2e accounts and anything else that must never be mailed. Decided by the caller. */
  excluded: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  /** `isGmailUnhealthy(...)` for this BD's email_account row (null row = never connected). */
  gmailUnhealthy: boolean;
  /** `sent_at` of every `sent` reminder row for this BD, any order. */
  sentReminders: readonly Date[];
}

export type ReminderSkipReason = "admin" | "excluded" | "gmail_healthy" | "not_due" | "series_complete";

export type ReminderDecision =
  | { bdId: string; action: "send"; number: 1 | 2 | 3; notifyOwner: boolean }
  | { bdId: string; action: "skip"; reason: ReminderSkipReason };

/** True exactly when the shell would show the red banner (disconnected, expired/revoked, missing read scope). */
export function isGmailUnhealthy(account: ConnectionBannerAccount | null, now: Date): boolean {
  return decideConnectionBanner({ account, now })?.tone === "danger";
}

/** True when at least `n` business days (Mon-Fri, Argentina calendar) lie in the interval (from, to]. */
function businessDaysElapsed(from: Date, to: Date, n: number): boolean {
  const end = argentinaCalendarDate(to);
  let day = argentinaCalendarDate(from);
  let count = 0;
  while (day < end && count < n) {
    day = addDaysToDateString(day, 1);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count >= n;
}

function planOne(c: ReminderCandidate, now: Date): ReminderDecision {
  const skip = (reason: ReminderSkipReason): ReminderDecision => ({ bdId: c.bdId, action: "skip", reason });
  if (c.role === "admin") return skip("admin");
  if (c.excluded) return skip("excluded");
  if (!c.gmailUnhealthy) return skip("gmail_healthy");

  const seenAt = c.lastSeenAt ?? c.createdAt;
  const series = c.sentReminders.filter((sentAt) => sentAt.getTime() > seenAt.getTime());
  if (series.length >= MAX_REMINDERS_PER_SERIES) return skip("series_complete");

  const last = series.reduce<Date | null>((acc, d) => (acc === null || d.getTime() > acc.getTime() ? d : acc), null);
  const due =
    last === null
      ? businessDaysElapsed(seenAt, now, FIRST_REMINDER_AFTER_DAYS)
      : businessDaysElapsed(last, now, REMINDER_SPACING_DAYS);
  if (!due) return skip("not_due");

  const number = (series.length + 1) as 1 | 2 | 3;
  return { bdId: c.bdId, action: "send", number, notifyOwner: number === MAX_REMINDERS_PER_SERIES };
}

export function planGmailReminders(candidates: readonly ReminderCandidate[], now: Date): ReminderDecision[] {
  return candidates.map((c) => planOne(c, now));
}
