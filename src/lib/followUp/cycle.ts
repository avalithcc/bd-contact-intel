/**
 * follow-up-expiry: the pure cycle rules (owner decisions 2026-10-27, openspec/changes/follow-up-expiry).
 *
 * A CYCLE starts the day a contact is first materialized in a daily queue after its latest touch and ends with any new touch
 * (or a drop). The expiry clock counts calendar days since that entry, NOT since the last touch:
 *   days 0-2  normal (Hoy), days 3-9 Vencido, day 10 the system drops it.
 * Dates are Argentina calendar dates (`YYYY-MM-DD`), the same values `follow_up_queue_item.queue_date` stores.
 */
import { ES_MONTH_ABBR, addDaysToDateString } from "@/lib/tasks/argentinaDate";

/** A contact enters the queue this many days after its last touch (Respondió and Contactado alike). */
export const FOLLOW_UP_ENTRY_DAYS = 5;
export const FOLLOW_UP_OVERDUE_FROM_DAY = 3;
export const FOLLOW_UP_EXPIRY_DAYS = 10;

const MS_PER_DAY = 86_400_000;

function dateMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function daysInQueue(cycleStartedOn: string, today: string): number {
  return Math.round((dateMs(today) - dateMs(cycleStartedOn)) / MS_PER_DAY);
}

export type CycleStage = "normal" | "overdue" | "expired";

export function cycleStage(days: number): CycleStage {
  if (days >= FOLLOW_UP_EXPIRY_DAYS) return "expired";
  return days >= FOLLOW_UP_OVERDUE_FROM_DAY ? "overdue" : "normal";
}

/** Day 3 in the queue reads "vencido hace 1 d". */
export function daysOverdue(days: number): number {
  return Math.max(0, days - (FOLLOW_UP_OVERDUE_FROM_DAY - 1));
}

export function expiryDate(cycleStartedOn: string): string {
  return addDaysToDateString(cycleStartedOn, FOLLOW_UP_EXPIRY_DAYS);
}

export function daysUntilExpiry(cycleStartedOn: string, today: string): number {
  return FOLLOW_UP_EXPIRY_DAYS - daysInQueue(cycleStartedOn, today);
}

export const FOLLOW_UP_DROP_REASONS = ["not_now", "other_bd", "no_response", "bad_contact", "other"] as const;
export type FollowUpDropReason = (typeof FOLLOW_UP_DROP_REASONS)[number];

export const FOLLOW_UP_DROP_DETAIL_MAX = 500;

export type DropInput =
  | { ok: true; reason: FollowUpDropReason; detail: string | null }
  | { ok: false; error: "reason_required" | "detail_required" | "detail_too_long" };

/** Server-side twin of the dialog's validation: a known reason, and a detail only "other" requires. */
export function parseDropInput(reason: unknown, detail: unknown): DropInput {
  if (typeof reason !== "string" || !(FOLLOW_UP_DROP_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: "reason_required" };
  }
  const trimmed = typeof detail === "string" ? detail.trim() : "";
  if (trimmed.length > FOLLOW_UP_DROP_DETAIL_MAX) return { ok: false, error: "detail_too_long" };
  if (reason === "other" && trimmed === "") return { ok: false, error: "detail_required" };
  return { ok: true, reason: reason as FollowUpDropReason, detail: trimmed === "" ? null : trimmed };
}

/** `status` is the pipeline status AT the drop, so the row can say "el estado sigue en X" without a lookup. */
export function buildDroppedMetadata(input: { reason: FollowUpDropReason; detail: string | null; cycleStartedOn: string; status: string }) {
  return { reason: input.reason, detail: input.detail, cycleStartedOn: input.cycleStartedOn, status: input.status };
}

export function buildExpiredMetadata(cycleStartedOn: string, today: string, status: string) {
  return { cycleStartedOn, daysInQueue: daysInQueue(cycleStartedOn, today), status };
}

/** "17 oct" from a stored `YYYY-MM-DD` cycle date (a calendar date, never shifted through a timezone). */
export function formatCycleDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${ES_MONTH_ABBR[m! - 1]}`;
}

export interface QueueItemForClassify {
  queueDate: string;
  /** Null for a row written before follow-up-expiry: it belongs to no cycle and never goes overdue. */
  cycleStartedOn: string | null;
  position: number;
}

export type OverdueItem<T> = T & { daysInQueue: number; daysOverdue: number; expiresOn: string };

/**
 * Splits a BD's open items into "Hoy" (days 0-2: carried items first, oldest entry first, then queue position) and
 * "Vencidos" (days 3-9, closest to the automatic drop first). Day 10+ is dropped even if the nightly job has not run yet, so
 * no item ever shows past its deadline. Pure: never mutates `items`.
 */
export function classifyQueueItems<T extends QueueItemForClassify>(
  items: readonly T[],
  today: string,
): { today: T[]; overdue: Array<OverdueItem<T>> } {
  const byEntryThenPosition = (a: T, b: T) =>
    (a.cycleStartedOn ?? a.queueDate).localeCompare(b.cycleStartedOn ?? b.queueDate) || a.position - b.position;
  const hoy: T[] = [];
  const overdue: Array<OverdueItem<T>> = [];
  for (const item of items) {
    if (item.cycleStartedOn === null) {
      if (item.queueDate === today) hoy.push(item);
      continue;
    }
    const days = daysInQueue(item.cycleStartedOn, today);
    const stage = cycleStage(days);
    if (stage === "normal") hoy.push(item);
    else if (stage === "overdue") {
      overdue.push({ ...item, daysInQueue: days, daysOverdue: daysOverdue(days), expiresOn: expiryDate(item.cycleStartedOn) });
    }
  }
  return { today: hoy.sort(byEntryThenPosition), overdue: overdue.sort(byEntryThenPosition) };
}
