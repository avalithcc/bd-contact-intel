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
  | "roleGroup"
  | "industry"
  | "country"
  | "source"
  | "created"
  | "seniority";

/** Mockup order (contacts.html column-picker menu, minus "BDs conectados"
 * and "Última actividad" — those need a join this phase's budget doesn't
 * cover; see tasks.md 13.1 deviation note). */
export const ALL_CONTACT_COLUMNS: readonly ContactColumnKey[] = [
  "company",
  "owner",
  "status",
  "email",
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
 * Keeps only recognized column keys, drops duplicates, and always returns
 * them in `ALL_CONTACT_COLUMNS` order regardless of input order — same
 * "never throw on unexpected shape" convention as sanitizeContactFilters.
 */
export function sanitizeColumnKeys(value: unknown): ContactColumnKey[] {
  if (!Array.isArray(value)) return [];
  const requested = new Set(value.filter(isContactColumnKey));
  return ALL_CONTACT_COLUMNS.filter((key) => requested.has(key));
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
