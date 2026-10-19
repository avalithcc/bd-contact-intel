/**
 * Which instant a Sequence approval stores in `sequence_draft.scheduled_for`, from the BD's choice in the split button.
 * Pure. The runner is still the only sender; this only decides WHEN a step becomes due.
 *
 * The 09:00 Miami floor applies to EVERY mode (owner decision 2026-10-19: Sequences never send before 9:00 Miami):
 *  - cadence: today's behavior, the next Miami day at the Sequence's hour.
 *  - now:     the instant itself, or the floor of today's Miami day when it is still earlier (`waitsForFloor`).
 *  - at:      a time the BD chose; before the floor of ITS Miami day it is refused, never silently moved.
 * `immediate` says the caller should try a release right away for these members (always through the runner's checks,
 * claim and cap); it is false for cadence, for a chosen time and for a "now" that has to wait for the floor.
 */
import { slotState, slotInstant, type Slot, type SlotState } from "@/lib/sendSchedule/time";
import { releaseFloorFor, RELEASE_FLOOR_HOUR } from "./releasePlan";
import { DEFAULT_SCHEDULE, step1DueAt, type Schedule } from "./schedule";

export type SendChoice = { kind: "cadence" } | { kind: "now" } | ({ kind: "at" } & Slot);
export type SendMomentRefusal = Exclude<SlotState, "ok">;
export type SendMoment = { ok: true; scheduledFor: Date; immediate: boolean; waitsForFloor: boolean } | { ok: false; reason: SendMomentRefusal };

export function resolveSequenceSend(choice: SendChoice, ctx: { now: Date; schedule?: Schedule }): SendMoment {
  const { now } = ctx;
  if (choice.kind === "cadence") return { ok: true, scheduledFor: step1DueAt(now, ctx.schedule ?? DEFAULT_SCHEDULE), immediate: false, waitsForFloor: false };
  if (choice.kind === "now") {
    const floor = releaseFloorFor(now);
    const waits = now.getTime() < floor.getTime();
    return { ok: true, scheduledFor: waits ? floor : now, immediate: !waits, waitsForFloor: waits };
  }
  const state = slotState(choice, { now, floorHour: RELEASE_FLOOR_HOUR });
  const instant = slotInstant(choice);
  if (state !== "ok" || !instant) return { ok: false, reason: state === "ok" ? "invalid_time" : state };
  return { ok: true, scheduledFor: instant, immediate: false, waitsForFloor: false };
}

/** How many of `count` members leave now and how many wait, given the account's cap and what it already sent today. */
export function capOutlook(input: { count: number; cap: number; sentToday: number }): { now: number; deferred: number } {
  const now = Math.min(input.count, Math.max(0, input.cap - input.sentToday));
  return { now, deferred: input.count - now };
}
