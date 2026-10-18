/**
 * View-model of the admin "Estado de Gmail" fleet screen (openspec/changes/gmail-sync-fleet). Pure: no I/O, no copy.
 * fleetQueries.ts reads one raw row per BD; this decides what each row means, reusing the rules the BD's own banner and the
 * reminder cron already use (decideConnectionBanner, deriveSyncHealth, reminderPlan) so the owner sees what the BD sees.
 */
import { decideConnectionBanner } from "./connectionBanner";
import { MAX_REMINDERS_PER_SERIES, FIRST_REMINDER_AFTER_DAYS, REMINDER_SPACING_DAYS, reminderDueOn } from "./reminderPlan";
import { deriveSyncHealth, type SyncHealth } from "./syncHealth";
import { argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

export interface FleetAccount {
  status: string | null;
  grantedScopes: string | null;
  syncError: string | null;
  lastSyncedAt: Date | null;
  connectedAt: Date | null;
  /** `history_id` is set: the incremental cursor exists. */
  hasCursor: boolean;
  /** `backfill_page_token` is set: the initial import is still running. */
  backfilling: boolean;
}

export interface FleetRaw {
  bdId: string;
  name: string;
  email: string;
  role: string;
  remindersEnabled: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  /** The BD's `email_account` row; null when the BD never started connecting. */
  account: FleetAccount | null;
  /** `sent_at` of every `sent` reminder, any order. */
  sentReminders: readonly Date[];
  /** The newest synced email, either direction. */
  lastEmail: { at: Date; direction: "inbound" | "outbound" } | null;
  bouncesHard: number;
  bouncesSoft: number;
  failedSends: number;
  lastFailedError: string | null;
}

/** What the Conexión column says. `config`: authorized, but the server's Google credentials are broken (an admin fixes it). */
export type FleetConnection = "connected" | "reconnect" | "never" | "config";
export type ReconnectReason = "disconnected" | "missing_scope" | "expired";

export interface AccountClass {
  connection: FleetConnection;
  reconnectReason: ReconnectReason | null;
  sync: SyncHealth;
}

const NO_SYNC: SyncHealth = { state: "inactive", errorKind: null, sinceMs: null };

export function classifyAccount(account: FleetAccount | null, now: Date): AccountClass {
  if (!account) return { connection: "never", reconnectReason: null, sync: NO_SYNC };
  const sync = deriveSyncHealth({ ...account, now });
  const decision = decideConnectionBanner({ account, now });
  if (decision?.tone === "danger") return { connection: "reconnect", reconnectReason: decision.reason, sync };
  if (sync.state === "failing" && sync.errorKind === "config") return { connection: "config", reconnectReason: null, sync };
  return { connection: "connected", reconnectReason: null, sync };
}

const isHealthy = (c: AccountClass) => c.connection === "connected" && c.sync.state === "ok";

export type ReminderView =
  | { kind: "admin" | "disabled" | "healthy" | "authorization_ok" | "not_applicable" }
  | {
      kind: "series";
      sent: number;
      /** ART day of the last reminder of this series. */
      lastOn: string | null;
      /** ART day the next one falls due; null once the series is complete. */
      nextOn: string | null;
      /** 2 before the first reminder, 3 between the others. */
      spacingDays: number;
      /** `nextOn` is today or earlier: it goes out on the next cron run. */
      due: boolean;
      complete: boolean;
      /** The date the schedule runs from: the BD's last visit, or its sign-up when it never visited. */
      baseKind: "seen" | "created";
      baseOn: string;
    };

function reminderView(raw: FleetRaw, cls: AccountClass, now: Date): ReminderView {
  if (raw.role === "admin") return { kind: "admin" };
  if (!raw.remindersEnabled) return { kind: "disabled" };
  if (isHealthy(cls)) return { kind: "healthy" };
  if (cls.connection === "config") return { kind: "not_applicable" };
  if (cls.connection === "connected") return { kind: "authorization_ok" };

  // reminderPlan.ts: a series is the reminders sent AFTER the BD was last seen (sign-up counts as seen when it never visited).
  const seenAt = raw.lastSeenAt ?? raw.createdAt;
  const series = raw.sentReminders.filter((d) => d.getTime() > seenAt.getTime());
  const last = series.reduce<Date | null>((acc, d) => (acc === null || d.getTime() > acc.getTime() ? d : acc), null);
  const complete = series.length >= MAX_REMINDERS_PER_SERIES;
  const spacingDays = last === null ? FIRST_REMINDER_AFTER_DAYS : REMINDER_SPACING_DAYS;
  const nextOn = complete ? null : reminderDueOn(last ?? seenAt, spacingDays);
  return {
    kind: "series",
    sent: series.length,
    lastOn: last ? argentinaCalendarDate(last) : null,
    nextOn,
    spacingDays,
    due: nextOn !== null && nextOn <= argentinaCalendarDate(now),
    complete,
    baseKind: raw.lastSeenAt ? "seen" : "created",
    baseOn: argentinaCalendarDate(seenAt),
  };
}

export interface FleetRow extends FleetRaw, AccountClass {
  reminder: ReminderView;
  /** The "Enviar recordatorio" button: a non-admin BD who must reconnect or never connected, with reminders on and the series not finished. */
  canSendReminder: boolean;
  attention: boolean;
}

export function buildFleetRow(raw: FleetRaw, now: Date): FleetRow {
  const cls = classifyAccount(raw.account, now);
  const reminder = reminderView(raw, cls, now);
  return {
    ...raw,
    ...cls,
    reminder,
    canSendReminder: reminder.kind === "series" && !reminder.complete,
    attention: !isHealthy(cls),
  };
}

export interface FleetSummary {
  total: number;
  healthy: number;
  reconnect: number;
  failing: number;
  never: number;
  attention: number;
}

export function summarizeFleet(rows: readonly FleetRow[]): FleetSummary {
  const s: FleetSummary = { total: rows.length, healthy: 0, reconnect: 0, failing: 0, never: 0, attention: 0 };
  for (const r of rows) {
    if (r.connection === "reconnect") s.reconnect++;
    else if (r.connection === "never") s.never++;
    else if (r.connection === "config" || r.sync.state !== "ok") s.failing++;
    else s.healthy++;
  }
  s.attention = s.total - s.healthy;
  return s;
}

export const FLEET_FILTERS = ["all", "attention", "healthy"] as const;
export type FleetFilter = (typeof FLEET_FILTERS)[number];

export function parseFleetFilter(value: string | undefined): FleetFilter {
  return FLEET_FILTERS.find((f) => f === value) ?? "all";
}

export function filterFleet(rows: readonly FleetRow[], filter: FleetFilter): FleetRow[] {
  if (filter === "attention") return rows.filter((r) => r.attention);
  if (filter === "healthy") return rows.filter((r) => !r.attention);
  return [...rows];
}

/** A BD created in the last 14 days gets the "Nueva" badge (same window as the Lusha screen). */
export const NEW_BD_DAYS = 14;
export const isNewFleetBd = (row: Pick<FleetRaw, "createdAt">, now: Date): boolean => now.getTime() - row.createdAt.getTime() < NEW_BD_DAYS * 86_400_000;

/** The sidebar counter: how many BDs would show up under "Necesitan atención". */
export function countAttention(accounts: readonly (FleetAccount | null)[], now: Date): number {
  return accounts.filter((a) => !isHealthy(classifyAccount(a, now))).length;
}
