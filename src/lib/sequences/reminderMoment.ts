/**
 * When an approved step 2 reminder leaves. Not `approvedMoment`: that one falls back to step 1's cadence rule, which is
 * wrong for a reminder (its instant is `reminderReleaseAt`, already stored in `scheduledFor` at approval). Pure.
 */
import { LOCK_MS } from "@/lib/scheduledEmail/plan";

export interface ReminderMoment {
  at: Date;
  /** `locked`: leaves in under 2 minutes. `overdue`: its moment passed and something (the daily cap, a check) holds it. */
  phase: "future" | "locked" | "overdue";
}

export function reminderMoment(d: { scheduledFor: Date | null }, now: Date): ReminderMoment | null {
  if (!d.scheduledFor) return null;
  const lead = d.scheduledFor.getTime() - now.getTime();
  return { at: d.scheduledFor, phase: lead < 0 ? "overdue" : lead < LOCK_MS ? "locked" : "future" };
}
