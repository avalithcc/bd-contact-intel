/**
 * Which instant a Sequence approval stores in `sequence_draft.scheduled_for`, from the BD's choice in the split button.
 * Pure. The runner is still the only sender; this only decides WHEN a step becomes due.
 *
 * Explicit choices are respected (owner decision 2026-10-19, final): "now" is the instant itself and a chosen time is
 * sent exactly then, even before 09:00 Miami. The 09:00 Miami floor belongs to the cadence option only (today's
 * behavior): its instant is never earlier than the floor of its Miami day. The daily cap and every pre-send check still
 * apply at release; whether the recipient's local time is a bad moment is a disclaimer in the UI, not a rule here.
 * `immediate` says the caller should try a release right away for these members.
 */
import { slotInstant, slotState, type Slot, type SlotState } from "@/lib/sendSchedule/time";
import { releaseFloorFor } from "./releasePlan";
import { DEFAULT_SCHEDULE, step1DueAt, type Schedule } from "./schedule";

export type SendChoice = { kind: "cadence" } | { kind: "now" } | ({ kind: "at" } & Slot);
export type SendMomentRefusal = Exclude<SlotState, "ok">;
export type SendMoment = { ok: true; scheduledFor: Date; immediate: boolean } | { ok: false; reason: SendMomentRefusal };

/**
 * A server action receives `unknown`. An ABSENT choice is the cadence (today's behavior); anything present that is not exactly
 * one of the three shapes is null, so the caller refuses it: a mangled "send now" must never quietly become "tomorrow 9:00".
 */
export function parseSendChoice(raw: unknown): SendChoice | null {
  if (raw === undefined) return { kind: "cadence" };
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "cadence") return { kind: "cadence" };
  if (r.kind === "now") return { kind: "now" };
  if (r.kind === "at" && typeof r.date === "string" && typeof r.time === "string") return { kind: "at", date: r.date, time: r.time };
  return null;
}

export function resolveSequenceSend(choice: SendChoice, ctx: { now: Date; schedule?: Schedule }): SendMoment {
  const { now } = ctx;
  if (choice.kind === "cadence") {
    const due = step1DueAt(now, ctx.schedule ?? DEFAULT_SCHEDULE);
    const floor = releaseFloorFor(due);
    return { ok: true, scheduledFor: due.getTime() < floor.getTime() ? floor : due, immediate: false };
  }
  if (choice.kind === "now") return { ok: true, scheduledFor: now, immediate: true };
  const state = slotState(choice, { now });
  const instant = slotInstant(choice);
  if (state === "ok" && instant) return { ok: true, scheduledFor: instant, immediate: false };
  return { ok: false, reason: state === "ok" ? "invalid_time" : state };
}

/**
 * What the approval actions check before touching the database: every id is a uuid (a malformed one is "not found", not a
 * driver error) and the choice is readable. Pure, so the refusals are tested without a session.
 */
export function guardApprovalInput(ids: readonly string[], when: unknown, isUuid: (v: string) => boolean): { ok: true; choice: SendChoice } | { ok: false; rejected: { memberId: string; reason: "not_found" | "invalid_time" }[] } {
  const bad = ids.filter((id) => !isUuid(id));
  if (bad.length) return { ok: false, rejected: bad.map((memberId) => ({ memberId, reason: "not_found" as const })) };
  const choice = parseSendChoice(when);
  if (!choice) return { ok: false, rejected: ids.map((memberId) => ({ memberId, reason: "invalid_time" as const })) };
  return { ok: true, choice };
}

/** How many of `count` members leave now and how many wait, given the account's cap and what it already sent today. */
export function capOutlook(input: { count: number; cap: number; sentToday: number }): { now: number; deferred: number } {
  const now = Math.min(input.count, Math.max(0, input.cap - input.sentToday));
  return { now, deferred: input.count - now };
}
