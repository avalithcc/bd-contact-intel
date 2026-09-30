/**
 * "Última actividad" column (mockups/contacts.html: "Correo enviado ·
 * hace 2d", "Descartado · hace 2sem", "—" when a person has no activity at
 * all). Pure label derivation only — no I/O — the actual `activity` table
 * read (one row per person, the most recent) lives in
 * listQueries.ts#attachLastActivity, which calls `buildLastActivityEntries`
 * on its result. Reuses the SAME activity-type taxonomy the record page's
 * Timeline renders (src/lib/activity/queries.ts TIMELINE_ACTIVITY_TYPES) —
 * no new type invented here, just a different (denser, table-cell) label
 * for each.
 */
import { parseDbTimestamp } from "@/lib/db/timestamp";
import type { getDictionary } from "@/lib/i18n/server";

type Dict = Awaited<ReturnType<typeof getDictionary>>;

export interface LastActivityRawRow {
  personId: string;
  type: string;
  metadata: unknown;
  // A raw SQL *computed expression* (effectiveActivityAtSql() in
  // listQueries.ts) — postgres-js does not always parse a computed
  // timestamptz expression's wire value into a JS Date the way it does for
  // a plain column reference, so this comes back as a string at runtime
  // (e.g. "2026-09-25 13:30:00+00") even though it's typed `Date` at the
  // call site. Same class of bug src/lib/outreach/queries.ts already
  // normalizes `lastMessageAt` for. When it IS a string, it can also be
  // offset-less (`effectiveActivityAtSql()`'s `else` branch is a bare
  // `timestamp without time zone` column before Postgres's CASE-expression
  // type unification promotes it) — `buildLastActivityEntries` below is the
  // single place this gets coerced to a real UTC `Date` (via the shared
  // src/lib/db/timestamp.ts#parseDbTimestamp helper) — every consumer
  // (relative-time render, CSV export) reads the already-normalized
  // `LastActivityEntry.createdAt`, never this raw field. `null` when the
  // picked row is a NON_TOUCH_ACTIVITY_TYPES type (effectiveActivityAtSql's
  // NULL branch) — only reachable when a person's ONLY activity is
  // non-touch; buildLastActivityEntries treats that the same as "no last
  // activity" (skips the row instead of coercing `null` into a Date).
  createdAt: Date | string | null;
}

export interface LastActivityEntry {
  type: string;
  label: string;
  createdAt: Date;
}

function metadataStatus(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const status = (metadata as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}

/**
 * Maps one activity row to its mockup label. `status_change`/
 * `status_backfill` special-case "replied" (mockup: "Respuesta recibida");
 * every other status falls back to that status's own leadStatuses label so
 * an unexpected/future status never renders blank, and a missing/malformed
 * `metadata.status` falls back to the generic `lastActivityStatusChanged`
 * label rather than throwing.
 */
export function formatLastActivityLabel(
  row: Pick<LastActivityRawRow, "type" | "metadata">,
  dict: Dict,
): string {
  const l = dict.contactList;
  switch (row.type) {
    case "email_sent":
      return l.lastActivityEmailSent;
    // Synced Gmail reply (email-sync brief) — reuses the SAME "Respuesta
    // recibida" label a status_change/status_backfill to 'replied' already
    // uses below, since both mean the same thing to a BD scanning the list.
    case "reply_received":
      return l.lastActivityReplyReceived;
    case "meeting_logged":
      return l.lastActivityMeetingLogged;
    case "discarded":
      return l.lastActivityDiscarded;
    case "note":
      return l.lastActivityNote;
    case "hunter_lookup":
      return l.lastActivityHunterLookup;
    case "status_change":
    case "status_backfill": {
      const status = metadataStatus(row.metadata);
      if (status === "replied") return l.lastActivityReplyReceived;
      if (status) return dict.leadStatuses[status as keyof typeof dict.leadStatuses] ?? l.lastActivityStatusChanged;
      return l.lastActivityStatusChanged;
    }
    default:
      return l.lastActivityStatusChanged;
  }
}

/** One raw row per person (the DB layer already dedups to the single most
 * recent row via `DISTINCT ON`) mapped into the render-ready entry. A `null`
 * `createdAt` (the DISTINCT ON pick landed on a NON_TOUCH_ACTIVITY_TYPES row
 * because that person has no real touch at all) is skipped — same as having
 * zero activity rows — rather than coerced into a bogus `new Date(null)`
 * (1970-01-01). */
export function buildLastActivityEntries(
  rows: LastActivityRawRow[],
  dict: Dict,
): Map<string, LastActivityEntry> {
  const map = new Map<string, LastActivityEntry>();
  for (const row of rows) {
    if (row.createdAt === null) continue;
    map.set(row.personId, {
      type: row.type,
      label: formatLastActivityLabel(row, dict),
      createdAt: parseDbTimestamp(row.createdAt),
    });
  }
  return map;
}
