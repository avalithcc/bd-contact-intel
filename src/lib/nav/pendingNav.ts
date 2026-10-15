/**
 * Pure rules for the sidebar's optimistic "pending" highlight. Next 15.1 has
 * no `useLinkStatus` (it landed in 15.3) and `usePathname()` only changes once
 * a navigation COMMITS, so on a slow route the clicked item stayed dark and
 * the previous one stayed lit (owner report: "no se entiende si el click hizo
 * efecto"). The Sidebar therefore remembers the clicked item until the
 * pathname confirms it; these functions hold the decisions so they are
 * testable without React.
 */

/** The subset of a React mouse event the decision needs. */
export interface NavClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

function pathOf(href: string): string {
  return href.split(/[?#]/)[0];
}

/**
 * Whether a click should mark `itemHref` as pending. False for modified or
 * non-left clicks (they open a new tab/window, so this page never navigates
 * and the highlight would stick forever) and for the exact route she is
 * already on (no navigation happens, so nothing would ever clear it). Equality,
 * not a prefix: from a record page (`/companies/<key>`) a click on the list
 * entry is a real, slow navigation and must get feedback. The Sidebar's
 * timeout is the safety net for any same-route case that slips through.
 */
export function shouldSetPending(event: NavClickLike, pathname: string, itemHref: string): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return pathname !== pathOf(itemHref);
}

/**
 * Whether the item draws as `.active`. While a click is pending the highlight
 * is the pending item alone — matched by item identity, not by path, because
 * "Contactos" and its outreach shortcut share the `/contacts` path. With
 * nothing pending it is the pathname-prefix rule the sidebar always used.
 */
export function isNavItemActive(pathname: string, pendingHref: string | null, itemHref: string): boolean {
  if (pendingHref !== null) return pendingHref === itemHref;
  return pathname.startsWith(itemHref);
}
