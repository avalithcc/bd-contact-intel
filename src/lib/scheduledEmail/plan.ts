/**
 * Pure rules of "scheduled send": limits, lock window, state transitions and the Argentina/Miami time helpers. No DB, no
 * clock of its own (callers pass `now`), and nothing here mutates its input.
 */
export const MIN_LEAD_MS = 5 * 60_000;
export const MAX_LEAD_MS = 30 * 24 * 60 * 60_000;
export const LOCK_MS = 2 * 60_000;
export const MAX_PENDING = 50;
export const BATCH_SIZE = 10;
// A row stuck in 'sending' this long means the run that claimed it died; see run.ts for why it is never retried.
export const STALE_SENDING_MS = 10 * 60_000;

export type ScheduledStatus = "scheduled" | "sending" | "sent" | "on_hold" | "failed" | "cancelled";
/** Statuses that count against the per-BD cap: the ones that are, or may still be, going out. */
export const PENDING_STATUSES: readonly ScheduledStatus[] = ["scheduled", "sending", "on_hold"];
/** Statuses the owner may edit or cancel (a 'scheduled' one only until the lock window). */
export const OPEN_STATUSES: readonly ScheduledStatus[] = ["scheduled", "on_hold", "failed"];

const TRANSITIONS: Record<ScheduledStatus, readonly ScheduledStatus[]> = {
  scheduled: ["sending", "on_hold", "cancelled"],
  sending: ["sent", "failed", "cancelled"], // cancelled only before Gmail is called (a suppressed recipient)
  on_hold: ["scheduled", "cancelled"],
  failed: ["scheduled", "cancelled"],
  sent: [],
  cancelled: [],
};

export function canTransition(from: ScheduledStatus, to: ScheduledStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type ScheduleRefusal = "schedule_too_soon" | "schedule_too_far" | "schedule_cap_reached" | "schedule_locked";

export function planSchedule(input: {
  sendAt: Date;
  now: Date;
  pendingCount: number;
}): { ok: true; sendAt: Date } | { ok: false; reason: ScheduleRefusal } {
  const lead = input.sendAt.getTime() - input.now.getTime();
  if (!(lead >= MIN_LEAD_MS)) return { ok: false, reason: "schedule_too_soon" }; // also catches an Invalid Date (NaN)
  if (lead > MAX_LEAD_MS) return { ok: false, reason: "schedule_too_far" };
  if (input.pendingCount >= MAX_PENDING) return { ok: false, reason: "schedule_cap_reached" };
  return { ok: true, sendAt: new Date(input.sendAt.getTime()) };
}

/** True when the owner can no longer edit or cancel: the dispatcher is about to (or did) pick the row up. */
export function isLocked(row: { status: ScheduledStatus; sendAt: Date }, now: Date): boolean {
  if (row.status === "on_hold" || row.status === "failed") return false;
  if (row.status !== "scheduled") return true;
  return row.sendAt.getTime() - now.getTime() <= LOCK_MS;
}

export const ZONES = { argentina: "America/Argentina/Buenos_Aires", miami: "America/New_York" } as const;
export type ZoneKey = keyof typeof ZONES;

function offsetMs(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) - at.getTime();
}

/** `YYYY-MM-DD` + `HH:mm` read as a wall clock in `zone` -> the real instant (null when malformed or nonexistent). */
export function wallTimeToInstant(date: string, time: string, zone: ZoneKey): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +t[1]!, +t[2]!);
  const roundTrip = new Date(guess);
  if (roundTrip.getUTCMonth() !== +m[2]! - 1 || roundTrip.getUTCHours() !== +t[1]!) return null; // 2026-13-40, 25:00
  const tz = ZONES[zone];
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz)); // second pass settles the DST edge
}

/** "lun 19 oct, 10:00" in the given zone (es-AR). */
export function formatSendAt(at: Date, zone: ZoneKey): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONES[zone], weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(at).replace(/\./g, "");
}
