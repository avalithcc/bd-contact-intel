/**
 * Column picker for the `/contacts` list (task 13.1; contact-list spec
 * "Column selection": "The list MUST let a BD choose which columns are
 * visible"). Pure sanitize/resolve pair — no I/O — mirrors the
 * viewFilters.ts convention: the page and the DB glue (savedViews.ts) both
 * import this, never the other way around.
 *
 * "Nombre" is always visible (mockup: its checkbox is checked+disabled) and
 * is never part of the stored/selectable set below.
 */

export type ContactColumnKey =
  | "company"
  | "owner"
  | "status"
  | "email"
  | "phone"
  | "bdConnections"
  | "lastActivity"
  | "roleGroup"
  | "industry"
  | "country"
  | "source"
  | "created"
  | "seniority";

/** Mockup order (contacts.html column-picker menu) — every column the
 * mockup lists is now selectable. */
export const ALL_CONTACT_COLUMNS: readonly ContactColumnKey[] = [
  "company",
  "owner",
  "status",
  "email",
  // Migration 0016 — "Teléfono" column (contacts.html "Columnas" picker).
  "phone",
  "bdConnections",
  "lastActivity",
  "roleGroup",
  "industry",
  "country",
  "source",
  "created",
  // Closes the `/leads` parity gap (task 13.3 inventory): `person.seniority`
  // existed in the DB with no UI surface at all until this batch.
  "seniority",
];

/** Matches the fixed column set the `/contacts` page shipped with pre-13.1
 * (task 12.5), so existing views render unchanged until a BD opts in. */
export const DEFAULT_CONTACT_COLUMNS: readonly ContactColumnKey[] = [
  "company",
  "owner",
  "status",
  "email",
];

function isContactColumnKey(value: unknown): value is ContactColumnKey {
  return (
    typeof value === "string" &&
    (ALL_CONTACT_COLUMNS as readonly string[]).includes(value)
  );
}

/**
 * Keeps only recognized column keys, drops duplicates (first occurrence
 * wins), and preserves the CALLER's order — not a fixed order — so the
 * "Columnas" picker's drag-and-drop reorder (mockup: "arrastrar para
 * reordenar") actually persists through the same `?columns=`/saved-view
 * round-trip visibility already uses. Same "never throw on unexpected
 * shape" convention as sanitizeContactFilters.
 */
export function sanitizeColumnKeys(value: unknown): ContactColumnKey[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ContactColumnKey>();
  const result: ContactColumnKey[] = [];
  for (const entry of value) {
    if (isContactColumnKey(entry) && !seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result;
}

/**
 * Resolves the columns to render: a valid explicit selection (from a saved
 * view's `columns` jsonb, or a `?columns=` query override) wins; anything
 * empty or fully unrecognized falls back to DEFAULT_CONTACT_COLUMNS.
 */
export function resolveVisibleColumns(
  requested: unknown,
): ContactColumnKey[] {
  const sanitized = sanitizeColumnKeys(requested);
  return sanitized.length ? sanitized : [...DEFAULT_CONTACT_COLUMNS];
}
