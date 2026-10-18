/**
 * The words of the Gmail fleet screen's cells and alerts (mockups/estado-gmail-equipo.html), decided from a FleetRow. Pure:
 * the page only lays out what these return, and every word comes from the `gmailFleet` dictionary block. Lives in a plain
 * module (not the table component) so server code can call it freely.
 */
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { formatSince } from "./connectionBanner";
import { formatAgo, formatInstant, formatYmdDayMonth } from "./fleetFormat";
import type { FleetRow } from "./fleetView";

export type FleetDict = Dictionary["gmailFleet"];

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
const MAX_ERROR_CHARS = 60;
const READ_SCOPE = "gmail.readonly";

const truncate = (text: string) => (text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS).trimEnd()}…` : text);

export interface TextLine {
  text: string;
  /** Rendered as "text (mono)" with the mono part in the code font. */
  mono?: string;
}

export interface SyncCell {
  /** "hoy 10:42", or "Nunca". */
  when: string;
  ago: string | null;
  /** The warn chip under the date: an authorized account whose sync is failing, or has gone quiet. */
  chip: "failing" | "stale" | null;
  lines: TextLine[];
}

/** One line for the BD's recorded sync error, labelled by what kind of error it is (decision 1: show the text). */
function errorLine(row: FleetRow, d: FleetDict): TextLine | null {
  const text = row.account?.syncError?.trim();
  if (!text) return null;
  const shown = truncate(text);
  if (row.sync.errorKind === "config") return { text: shown };
  return { text: fill(row.sync.errorKind === "auth" ? d.errorAuth : d.errorOther, { text: shown }) };
}

export function syncCell(row: FleetRow, d: FleetDict, now: Date, locale: Locale): SyncCell {
  const account = row.account;
  if (!account) return { when: d.neverSynced, ago: null, chip: null, lines: [{ text: d.noAccount }] };

  const healthy = row.connection === "connected" && row.sync.state === "ok";
  const when = account.lastSyncedAt ? formatInstant(account.lastSyncedAt, now, d.time) : d.neverSynced;
  let ago: string | null = null;
  if (account.lastSyncedAt) {
    const sinceMs = Math.max(0, now.getTime() - account.lastSyncedAt.getTime());
    ago = healthy ? formatSince(sinceMs, locale) : `${formatAgo(sinceMs, d.time)} · ${d.lastSuccess}`;
  }

  const lines: TextLine[] = [];
  let chip: SyncCell["chip"] = null;
  const error = errorLine(row, d);
  if (row.connection === "reconnect") {
    if (row.reconnectReason === "missing_scope") lines.push({ text: d.missingScope, mono: READ_SCOPE });
    else if (row.reconnectReason === "expired") lines.push({ text: d.expiredLine });
    else lines.push({ text: d.disconnectedLine });
    if (row.reconnectReason === "expired" && error) lines.push(error);
  } else if (row.connection === "config") {
    if (error) lines.push(error);
    lines.push({ text: d.configFix });
  } else if (row.sync.state === "failing") {
    chip = "failing";
    if (error) lines.push(error);
    lines.push({ text: d.reconnectDoesNotFix });
  } else if (row.sync.state === "stale") {
    chip = "stale";
  } else {
    lines.push({ text: account.backfilling ? d.cursorBackfilling : account.hasCursor ? d.cursorCaughtUp : d.cursorPending });
  }
  return { when, ago, chip, lines };
}

export function lastEmailCell(row: FleetRow, d: FleetDict, now: Date): { when: string; detail: string } | null {
  if (!row.lastEmail) return null;
  const direction = row.lastEmail.direction === "outbound" ? d.directionOutbound : d.directionInbound;
  return {
    when: formatInstant(row.lastEmail.at, now, d.time),
    detail: `${formatAgo(now.getTime() - row.lastEmail.at.getTime(), d.time)} · ${direction}`,
  };
}

export type BounceCell = { kind: "nodata" } | { kind: "count"; total: number; breakdown: string | null };

/** "Sin datos" only when there is nothing recorded AND the sync is not running (no account, or it must reconnect). */
export function bounceCell(row: FleetRow, d: FleetDict): BounceCell {
  const total = row.bouncesHard + row.bouncesSoft;
  if (total === 0) return row.connection === "never" || row.connection === "reconnect" ? { kind: "nodata" } : { kind: "count", total: 0, breakdown: null };
  // "blando" alone for a single bounce, "1 duro" next to others, "2 blandos" for several.
  const part = (n: number, one: string, many: string) => (n === 0 ? null : n === 1 ? (total === 1 ? one : `1 ${one}`) : fill(many, { n }));
  const soft = part(row.bouncesSoft, d.bouncesSoftOne, d.bouncesSoftMany);
  const hard = part(row.bouncesHard, d.bouncesHardOne, d.bouncesHardMany);
  return { kind: "count", total, breakdown: [soft, hard].filter(Boolean).join(" · ") };
}

export type FailedCell = { kind: "nodata" } | { kind: "zero" } | { kind: "failed"; count: number; code: string | null };

export function failedCell(row: FleetRow, _d: FleetDict): FailedCell {
  if (row.failedSends > 0) return { kind: "failed", count: row.failedSends, code: row.lastFailedError };
  return row.connection === "never" ? { kind: "nodata" } : { kind: "zero" };
}

export type ReminderCell = { kind: "note"; text: string } | { kind: "series"; count: string; word: string; lines: string[] };

export function reminderCell(row: FleetRow, d: FleetDict, now: Date): ReminderCell {
  const r = row.reminder;
  switch (r.kind) {
    case "admin":
      return { kind: "note", text: d.reminderAdmin };
    case "disabled":
      return { kind: "note", text: d.reminderDisabled };
    case "healthy":
      return { kind: "note", text: d.reminderHealthy };
    case "authorization_ok":
      return { kind: "note", text: d.reminderAuthorizationOk };
    case "not_applicable":
      return { kind: "note", text: d.reminderNotApplicable };
  }
  const lines: string[] = [];
  if (r.lastOn) lines.push(fill(d.lastSent, { date: formatYmdDayMonth(r.lastOn) }));
  else lines.push(fill(r.baseKind === "created" ? d.createdOn : d.lastVisit, { date: formatYmdDayMonth(r.baseOn) }));
  if (r.complete || !r.nextOn) lines.push(d.seriesComplete);
  else if (r.due) lines.push(r.sent === 0 ? d.firstDue : d.nextDue);
  else lines.push(fill(r.sent === 0 ? d.firstAt : d.nextAt, { date: formatYmdDayMonth(r.nextOn), n: r.spacingDays }));
  return { kind: "series", count: fill(d.seriesOf, { n: r.sent }), word: r.sent === 1 ? d.sentOne : d.sentMany, lines };
}

export interface FleetAlert {
  bdId: string;
  tone: "danger" | "warn";
  title: string;
  body: string;
}

/** One alert above the table per BD that must reconnect (red) or whose sync is failing or quiet (amber). Config failures and never-connected BDs have none, as in the mockup. */
export function fleetAlerts(rows: readonly FleetRow[], d: FleetDict, now: Date, locale: Locale): FleetAlert[] {
  const alerts: FleetAlert[] = [];
  for (const row of rows) {
    if (row.connection === "reconnect") {
      const last = row.account?.lastSyncedAt;
      const parts = [last ? fill(d.alertReconnectSince, { since: formatSince(Math.max(0, now.getTime() - last.getTime()), locale) }) : d.alertReconnectNever];
      if (row.reminder.kind === "series") {
        parts.push(row.reminder.sent > 0 ? fill(d.alertRemindersSent, { n: row.reminder.sent }) : d.alertRemindersNone, d.alertOwnerNotice);
      }
      alerts.push({ bdId: row.bdId, tone: "danger", title: fill(d.alertReconnectTitle, { name: row.name }), body: parts.join(" ") });
    } else if (row.connection === "connected" && row.sync.state === "failing") {
      alerts.push({ bdId: row.bdId, tone: "warn", title: fill(d.alertFailingTitle, { name: row.name }), body: d.alertFailingBody });
    } else if (row.connection === "connected" && row.sync.state === "stale") {
      alerts.push({ bdId: row.bdId, tone: "warn", title: fill(d.alertStaleTitle, { name: row.name }), body: d.alertStaleBody });
    }
  }
  return alerts;
}
