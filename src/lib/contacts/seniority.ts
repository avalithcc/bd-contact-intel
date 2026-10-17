/**
 * Display label for `person.seniority`. The column is free text (imports and
 * the lead ingest write whatever the source had: "C-Level", "senior",
 * "c_level"), so there is no fixed set. Known values are matched on a
 * normalized key (lowercase, runs of non-alphanumerics collapsed to "_") and
 * shown through the dictionary; anything else is shown verbatim, never hidden.
 * The stored value is never rewritten — this is display only.
 */
export const SENIORITY_KEYS = [
  "owner",
  "founder",
  "partner",
  "c_level",
  "assistant_c_level",
  "vp",
  "head",
  "director",
  "manager",
  "senior",
  "mid",
  "junior",
  "entry",
  "intern",
] as const;

export type SeniorityKey = (typeof SENIORITY_KEYS)[number];

/** Spellings seen in production whose normalized form differs from the key they mean. */
const SENIORITY_ALIASES: Record<string, SeniorityKey> = { clevel: "c_level" };

export function normalizeSeniorityKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function seniorityLabel(
  value: string | null | undefined,
  labels: Record<SeniorityKey, string>,
  empty = "—",
): string {
  if (!value || !value.trim()) return empty;
  const normalized = normalizeSeniorityKey(value);
  const key = SENIORITY_ALIASES[normalized] ?? normalized;
  return (SENIORITY_KEYS as readonly string[]).includes(key) ? labels[key as SeniorityKey] : value;
}

/** Filter select options: the stored value is what the filter sends, only the text is localized. */
export function seniorityOptions(
  stored: readonly string[],
  labels: Record<SeniorityKey, string>,
): { value: string; label: string }[] {
  return stored.map((v) => ({ value: v, label: seniorityLabel(v, labels) }));
}
