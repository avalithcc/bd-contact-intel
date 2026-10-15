/**
 * Which candidates the runner loads when more are due than it will take. Pure, and the ONE place that derives a step's
 * release instant: the cap's ordering and the candidate's `dueAt` both call `releaseInstant`, so they cannot disagree.
 * (A reminder's instant depends on `reminderReleaseAt`, which a raw `reminder_due_at` ordering in SQL does not reproduce:
 * a reminder approved late waits for the next release window.) The order is the planner's own (`byOrder`).
 */
import { byOrder } from "./releasePlan";
import { reminderReleaseAt, step1DueAt, type Schedule } from "./schedule";

export interface SlimRow {
  id: string;
  step: 1 | 2;
  scheduledFor: Date | null;
  reminderDueAt: Date | null;
  approvedAt: Date;
  schedule: Schedule;
}

export function releaseInstant(r: Pick<SlimRow, "step" | "scheduledFor" | "reminderDueAt" | "approvedAt" | "schedule">): Date {
  return r.step === 1 ? (r.scheduledFor ?? step1DueAt(r.approvedAt, r.schedule)) : reminderReleaseAt(r.reminderDueAt!, r.approvedAt, r.schedule)!;
}

/** The first `limit` due steps in release order, and whether more were due than fit (the cap cut something). */
export function pickReleaseKeys(rows: readonly SlimRow[], now: Date, limit: number): { keys: { id: string; step: 1 | 2 }[]; truncated: boolean } {
  const due = rows
    .map((r) => ({ id: r.id, step: r.step, dueAt: releaseInstant(r), approvedAt: r.approvedAt }))
    .filter((r) => r.dueAt.getTime() <= now.getTime())
    .sort(byOrder);
  return { keys: due.slice(0, limit).map(({ id, step }) => ({ id, step })), truncated: due.length > limit };
}
