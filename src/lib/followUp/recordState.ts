/**
 * The "Seguimiento" property of the contact record (follow-up-expiry mockup timeline-baja-seguimiento.html). Derived in JS from rows
 * the record page already loads (the person's activities, the connection clock) plus the owner's latest cycle row, so it costs no
 * round trip. It applies the same rules as the SQL in openCycle.ts: a touch (anything but NO_PROGRESS / NON_TOUCH types) after the
 * row ends the cycle, and a drop newer than the last touch keeps the contact out until a newer touch.
 */
import { NO_PROGRESS_ACTIVITY_TYPES } from "@/lib/activity/noProgressActivity";
import { resolveEffectiveActivityAt } from "@/lib/contacts/effectiveActivityTime";
import { FOLLOW_UP_DROPPED_TYPE, FOLLOW_UP_DROP_ACTIVITY_TYPES } from "@/lib/followUp/activityTypes";
import { cycleStage, daysInQueue, expiryDate } from "@/lib/followUp/cycle";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

export interface RecordCycle {
  cycleStartedOn: string;
  lastTouchAt: Date;
  createdAt: Date;
}

export interface RecordActivity {
  id: string;
  type: string;
  createdAt: Date;
  metadata: unknown;
}

export type FollowUpRecordState =
  | { kind: "in_queue"; since: string }
  | { kind: "overdue"; since: string; expiresOn: string }
  | { kind: "out"; by: "bd" | "system"; on: string; reason: string | null }
  | null;

const NO_PROGRESS = new Set<string>(NO_PROGRESS_ACTIVITY_TYPES);

function touchTime(a: RecordActivity): Date | null {
  if (NO_PROGRESS.has(a.type)) return null;
  const metadata = a.metadata && typeof a.metadata === "object" ? (a.metadata as Record<string, unknown>) : {};
  return resolveEffectiveActivityAt({ id: a.id, type: a.type, createdAt: a.createdAt, metadata });
}

export function deriveFollowUpRecordState(input: {
  cycle: RecordCycle | null;
  activities: readonly RecordActivity[];
  connectionLastMessageAt: Date | null;
  today: string;
}): FollowUpRecordState {
  const touches = input.activities.map(touchTime).filter((t): t is Date => t !== null);
  if (input.connectionLastMessageAt) touches.push(input.connectionLastMessageAt);
  const latestTouch = touches.reduce<Date | null>((best, t) => (best && best >= t ? best : t), null);

  const drops = input.activities.filter((a) => (FOLLOW_UP_DROP_ACTIVITY_TYPES as readonly string[]).includes(a.type));
  const latestDrop = drops.reduce<RecordActivity | null>((best, a) => (best && best.createdAt >= a.createdAt ? best : a), null);
  if (latestDrop && (!latestTouch || latestDrop.createdAt > latestTouch)) {
    const metadata = latestDrop.metadata && typeof latestDrop.metadata === "object" ? (latestDrop.metadata as Record<string, unknown>) : {};
    return {
      kind: "out",
      by: latestDrop.type === FOLLOW_UP_DROPPED_TYPE ? "bd" : "system",
      on: argentinaCalendarDate(latestDrop.createdAt),
      reason: typeof metadata.reason === "string" ? metadata.reason : null,
    };
  }

  const { cycle } = input;
  if (!cycle) return null;
  if (touches.some((t) => t > cycle.lastTouchAt)) return null;
  const days = daysInQueue(cycle.cycleStartedOn, input.today);
  switch (cycleStage(days)) {
    case "normal":
      return { kind: "in_queue", since: cycle.cycleStartedOn };
    case "overdue":
      return { kind: "overdue", since: cycle.cycleStartedOn, expiresOn: expiryDate(cycle.cycleStartedOn) };
    case "expired":
      // The nightly job has not written the activity yet; the page already treats the item as dropped.
      return { kind: "out", by: "system", on: expiryDate(cycle.cycleStartedOn), reason: null };
  }
}
