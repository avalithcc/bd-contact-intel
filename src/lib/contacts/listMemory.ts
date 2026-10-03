/**
 * "Back to the list she was working": the contacts list keeps every filter,
 * tab, sort and page in the URL query. Leaving it for a record drops that
 * query from the sidebar's bare `/contacts` link, so the shell remembers the
 * last list query (sessionStorage) and the link carries it back. Pure
 * helpers only; Sidebar.tsx owns the storage side effects.
 */
export const CONTACTS_LIST_PATH = "/contacts";
export const CONTACTS_LIST_MEMORY_KEY = "bd.contacts.listQuery";

/** The query to remember for this location, or `null` when it is not the list. */
export function listQueryToRemember(pathname: string, search: string): string | null {
  if (pathname !== CONTACTS_LIST_PATH) return null;
  return new URLSearchParams(search).toString();
}

/** Sidebar href for "Contactos": the remembered query, re-serialized so a
 * stored value can only ever become query params on `/contacts`. */
export function contactsListHref(remembered: string | null | undefined): string {
  const query = new URLSearchParams(remembered ?? "").toString();
  return query ? `${CONTACTS_LIST_PATH}?${query}` : CONTACTS_LIST_PATH;
}
