/**
 * Pure view rules of "scheduled send": which state a row is in for the BD, which actions that state offers, and the
 * Argentina/Miami labels. No DB, no clock of its own. The rules of the engine itself live in plan.ts.
 */
import { addDaysToDateString, argentinaCalendarDate } from "@/lib/tasks/argentinaDate";
import { ATTACHMENT_FAILURE_CODES } from "./codes";
import { ZONES, isLocked, wallTimeToInstant, type ScheduledStatus, type ZoneKey } from "./plan";

export interface ScheduledItem {
  id: string;
  personId: string;
  personName: string;
  company: string | null;
  toAddress: string;
  subject: string;
  body: string;
  sendAt: Date;
  status: ScheduledStatus;
  error: string | null;
  createdAt: Date;
  actorName: string;
  /** Only for an on_hold row: the reply that paused it. */
  replyAt: Date | null;
  replyText: string | null;
  /** When a 'cancelled' row was cancelled. */
  cancelledAt: Date | null;
  /** Files the row holds. The chips show name and size only (no download anywhere); the path lets the reschedule dialog keep a file. */
  attachments: { filename: string; size: number; storagePath: string; contentType: string }[];
  /** The other "Para" contacts (the row's own contact is `personName`). */
  otherRecipients: { id: string; name: string; email: string }[];
  ccAddresses: string[];
}

/** failed_unconfirmed: the outcome is unknown (the mail may have gone out); failed_other: Gmail provably did not send it. */
export type ScheduledState = "scheduled" | "locked" | "on_hold" | "failed_gmail" | "failed_unconfirmed" | "failed_other";
export type ScheduledAction = "edit" | "changeTime" | "sendNow" | "sendAnyway" | "reschedule" | "cancel";

export function stateOf(row: { status: ScheduledStatus; sendAt: Date; error: string | null }, now: Date): ScheduledState {
  if (row.status === "on_hold") return "on_hold";
  if (row.status === "failed") {
    if (row.error === "gmail_not_connected") return "failed_gmail";
    // Unknown or legacy codes are treated as unconfirmed. The attachment codes are provably-not-sent, like the others.
    return row.error === "gmail_unavailable" || row.error === "invalid_recipient" || (row.error !== null && ATTACHMENT_FAILURE_CODES.includes(row.error)) ? "failed_other" : "failed_unconfirmed";
  }
  return isLocked(row, now) ? "locked" : "scheduled";
}

const ACTIONS: Record<ScheduledState, readonly ScheduledAction[]> = {
  scheduled: ["edit", "changeTime", "sendNow", "cancel"],
  locked: [],
  on_hold: ["sendAnyway", "edit", "cancel"],
  failed_gmail: ["sendNow", "reschedule", "edit", "cancel"],
  failed_unconfirmed: ["sendNow", "reschedule", "edit", "cancel"],
  failed_other: ["sendNow", "reschedule", "edit", "cancel"],
};

export const actionsFor = (state: ScheduledState): readonly ScheduledAction[] => ACTIONS[state];

/** A dead-token row cannot be sent until the mailbox is reconnected. */
export const sendNowDisabled = (state: ScheduledState, gmailConnected: boolean): boolean => state === "failed_gmail" && !gmailConnected;

/** Sending again a row whose first attempt may have succeeded must be confirmed by the BD. */
export const needsSendConfirm = (state: ScheduledState): boolean => state === "failed_unconfirmed";

export function clockLabel(at: Date, zone: ZoneKey): string {
  const parts = new Intl.DateTimeFormat("es-AR", { timeZone: ZONES[zone], hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${Number(part("hour"))}:${part("minute")}`;
}

/** The weekday/day/month and the clock of an instant, apart ("lun 19 oct" and "10:00"). */
export function whenParts(at: Date, zone: ZoneKey): { day: string; clock: string } {
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: ZONES[zone], weekday: "short", day: "numeric", month: "short" }).format(at);
  return { day: day.replace(/[.,]/g, ""), clock: clockLabel(at, zone) };
}

/** "lun 19 oct, 10:00" in the given zone. */
export function whenLabel(at: Date, zone: ZoneKey): string {
  const { day, clock } = whenParts(at, zone);
  return `${day}, ${clock}`;
}

/** "16 oct, 14:20" in Argentina (when something was created or cancelled). */
export function stampLabel(at: Date): string {
  const day = new Intl.DateTimeFormat("es-AR", { timeZone: ZONES.argentina, day: "numeric", month: "short" }).format(at);
  return `${day.replace(/[.,]/g, "")}, ${clockLabel(at, "argentina")}`;
}

/** "<today> 9:00" when the moment fell on today's Argentina date, else the full label. `today` is the localized word. */
export function wasLabel(at: Date, now: Date, today: string): string {
  return argentinaCalendarDate(at) === argentinaCalendarDate(now) ? `${today} ${clockLabel(at, "argentina")}` : whenLabel(at, "argentina");
}

/** The "Lunes 9:00 en Miami" preset: the Monday after today (Miami calendar), 09:00 Miami. */
export function nextMondayNineMiami(now: Date): Date {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONES.miami }).format(now); // YYYY-MM-DD
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return wallTimeToInstant(addDaysToDateString(today, (8 - weekday) % 7 || 7), "09:00", "miami")!;
}

/** The first paragraph of a reply (before any quoted history), collapsed and bounded. */
export function replySnippet(text: string | null): string | null {
  const first = (text ?? "").split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim();
  if (!first) return null;
  return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}
