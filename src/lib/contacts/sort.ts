/**
 * `/contacts` table sort (mockups/contacts.html: "Nombre" and "Última
 * actividad ↓" are the two sortable headers; toolbar text "Ordenado por
 * Última actividad" — that's the default). Pure query-param parsing only —
 * no DB — listQueries.ts#getContactListPage applies the actual ORDER BY.
 */
export const CONTACT_SORT_KEYS = ["name", "lastActivity"] as const;
export type ContactSortKey = (typeof CONTACT_SORT_KEYS)[number];

export const DEFAULT_CONTACT_SORT: ContactSortKey = "lastActivity";

function isContactSortKey(value: string): value is ContactSortKey {
  return (CONTACT_SORT_KEYS as readonly string[]).includes(value);
}

/** Unknown/empty `?sort=` falls back to the mockup's default ("Última
 * actividad" desc) — same "never throw on unexpected shape" convention as
 * viewFilters.ts/columns.ts. */
export function parseContactSort(value: string | undefined): ContactSortKey {
  if (value && isContactSortKey(value)) return value;
  return DEFAULT_CONTACT_SORT;
}
