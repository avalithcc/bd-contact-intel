/**
 * What an approved step 1 looks like on its card: when it leaves, whether the BD chose that moment or it is the cadence, and
 * whether it is too close to change. Pure. There is no column for "who chose it": a stored moment equal to the cadence of the
 * approval is the cadence, any other value is a scheduled choice (a chosen time that happens to equal the cadence reads as
 * the cadence, which is true to what happens).
 */
import { LOCK_MS } from "@/lib/scheduledEmail/plan";
import { resolveSequenceSend } from "./sendMoment";
import type { Schedule } from "./schedule";

export interface ApprovedMoment {
  at: Date;
  mode: "cadence" | "scheduled";
  /** `locked`: leaves in under 2 minutes, the runner is about to take it. `overdue`: its moment passed and something (the daily cap, a check) is holding it. */
  phase: "future" | "locked" | "overdue";
}

export function approvedMoment(d: { scheduledFor: Date | null; approvedAt: Date | null }, schedule: Schedule, now: Date): ApprovedMoment | null {
  const cadence = d.approvedAt ? resolveSequenceSend({ kind: "cadence" }, { now: d.approvedAt, schedule }) : null;
  const cadenceAt = cadence?.ok ? cadence.scheduledFor : null;
  const at = d.scheduledFor ?? cadenceAt;
  if (!at) return null;
  const lead = at.getTime() - now.getTime();
  return {
    at,
    mode: cadenceAt && at.getTime() === cadenceAt.getTime() ? "cadence" : "scheduled",
    phase: lead < 0 ? "overdue" : lead < LOCK_MS ? "locked" : "future",
  };
}
