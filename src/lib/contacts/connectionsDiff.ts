/**
 * Change detection for the LinkedIn connections import. Re-importing a file
 * the BD already imported used to rewrite every contact and person one row at
 * a time and ran into Vercel's 300 s limit (2026-10-19). The writer now loads
 * the stored rows for a chunk once and only writes what actually differs.
 *
 * Pure: no db import, never mutates its inputs (see tests/unit/
 * connectionsImportDiff.test.ts).
 */

/** A contact row exactly as the writer would store it (parser output plus the derived columns). */
export interface ContactWriteRow {
  bdId: string;
  profileKey: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  position: string | null;
  email: string | null;
  connectedOn: string | null;
  roleGroup: string | null;
  companyCategory: string | null;
  companyKey: string | null;
}

/** What is stored for one of the chunk's profile keys, plus whether it already has a person_id_map row. */
export interface ExistingContactSnapshot extends Omit<ContactWriteRow, "bdId"> {
  id: string;
  mapped: boolean;
  industry: string | null;
  emailStatus: string;
  emailConfidence: number | null;
  emailSource: string | null;
}

/** The ONE key builder for the stored-contact index: builds it and reads it. */
export function contactDiffKey(profileKey: string): string {
  return profileKey.trim();
}

export function indexExistingContacts(rows: readonly ExistingContactSnapshot[]): Map<string, ExistingContactSnapshot> {
  return new Map(rows.map((r) => [contactDiffKey(r.profileKey), r]));
}

// Same normalization the parser applies (trim, blank -> null), so stray
// whitespace on either side never reads as a change.
function norm(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

const COMPARED_FIELDS = [
  "firstName",
  "lastName",
  "company",
  "position",
  "email",
  "connectedOn",
  "roleGroup",
  "companyCategory",
  "companyKey",
] as const satisfies readonly (keyof ContactWriteRow & keyof ExistingContactSnapshot)[];

function sameStored(row: ContactWriteRow, existing: ExistingContactSnapshot): boolean {
  return COMPARED_FIELDS.every((f) => norm(row[f]) === norm(existing[f]));
}

export interface ContactDiff {
  fresh: ContactWriteRow[];
  changed: ContactWriteRow[];
  unchanged: { row: ContactWriteRow; existing: ExistingContactSnapshot }[];
}

/**
 * A repeated profile key inside one chunk collapses to its last occurrence:
 * a single INSERT .. ON CONFLICT DO UPDATE cannot touch the same row twice.
 */
export function classifyContactRows(
  rows: readonly ContactWriteRow[],
  stored: ReadonlyMap<string, ExistingContactSnapshot>,
): ContactDiff {
  const lastByKey = new Map<string, ContactWriteRow>();
  for (const r of rows) lastByKey.set(contactDiffKey(r.profileKey), r);

  const out: ContactDiff = { fresh: [], changed: [], unchanged: [] };
  for (const [key, row] of lastByKey) {
    const existing = stored.get(key);
    if (!existing) out.fresh.push(row);
    else if (sameStored(row, existing)) out.unchanged.push({ row, existing });
    else out.changed.push(row);
  }
  return out;
}
