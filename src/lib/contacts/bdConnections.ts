/**
 * "BDs conectados" column (mockups/contacts.html: avatar-stack cell,
 * `title="Ana Pereyra, Juan Martínez, ..."`). Pure grouping/formatting only
 * — no I/O — the actual `person_bd_connection` join lives in
 * listQueries.ts#getContactBdConnectionsByIds, which calls
 * `groupBdConnectionsByPerson` + `buildBdConnectionSummaries` on its
 * result. Mirrors the pure-module convention used by columns.ts/board.ts.
 */
import { initialsFromName } from "@/components/initials";

export interface BdConnectionRow {
  personId: string;
  bdId: string;
  bdName: string;
}

/**
 * Buckets flat join rows by `personId`, preserving the original row order
 * within each bucket (join order is whatever the DB returned — no implicit
 * re-sort here).
 */
export function groupBdConnectionsByPerson(
  rows: BdConnectionRow[],
): Map<string, BdConnectionRow[]> {
  const grouped = new Map<string, BdConnectionRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.personId);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.personId, [row]);
    }
  }
  return grouped;
}

export interface BdConnectionAvatar {
  bdId: string;
  name: string;
  initials: string;
}

export interface BdConnectionSummary {
  avatars: BdConnectionAvatar[];
  /** Comma-joined full names, for the avatar-stack's `title` tooltip
   * (mockup: `title="Ana Pereyra, Juan Martínez, Cristian Civita"`). */
  title: string;
}

const EMPTY_SUMMARY: BdConnectionSummary = { avatars: [], title: "" };

/**
 * Maps one person's connected-BD rows into the avatar-stack's render shape.
 * Returns the shared `EMPTY_SUMMARY` for no connections so callers can
 * `!summary.avatars.length` cheaply without allocating per empty row.
 */
export function buildBdConnectionSummaries(rows: BdConnectionRow[]): BdConnectionSummary {
  if (!rows.length) return EMPTY_SUMMARY;
  return {
    avatars: rows.map((row) => ({
      bdId: row.bdId,
      name: row.bdName,
      initials: initialsFromName(row.bdName),
    })),
    title: rows.map((row) => row.bdName).join(", "),
  };
}
