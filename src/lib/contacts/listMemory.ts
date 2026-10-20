/**
 * "Back to the list she was working": the contacts list keeps every filter,
 * tab, sort and page in the URL query. Leaving it for a record drops that
 * query from the sidebar's bare `/contacts` link, so the shell remembers the
 * last list query (sessionStorage) and the link carries it back — minus the
 * search term, which always starts empty after leaving the list. Pure
 * helpers only; Sidebar.tsx owns the storage side effects.
 */
export const CONTACTS_LIST_PATH = "/contacts";
export const CONTACTS_LIST_MEMORY_KEY = "bd.contacts.listQuery";

/** The query to remember for this location, or `null` when it is not the list. */
export function listQueryToRemember(pathname: string, search: string): string | null {
  if (pathname !== CONTACTS_LIST_PATH) return null;
  return withoutSearchTerm(search);
}

/** The search box is never remembered (owner, 2026-10-20): leaving the list clears the search; filters, tab, sort and
 * page still come back. */
function withoutSearchTerm(query: string | null | undefined): string {
  const params = new URLSearchParams(query ?? "");
  params.delete("q");
  return params.toString();
}

/** Sidebar href for "Contactos": the remembered query, re-serialized so a
 * stored value can only ever become query params on `/contacts`. */
export function contactsListHref(remembered: string | null | undefined): string {
  const query = withoutSearchTerm(remembered);
  return query ? `${CONTACTS_LIST_PATH}?${query}` : CONTACTS_LIST_PATH;
}
