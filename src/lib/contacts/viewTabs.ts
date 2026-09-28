/**
 * Pure pinned/overflow split for the /contacts view-tabs row (owner-chosen
 * option A, owner feedback round 17/18): a fixed set of pinned tabs stays
 * visible at all widths (no horizontal scroll down to ~1024px), everything
 * else (remaining system views, the ranked "Outreach" tab, saved views,
 * "Guardar vista") moves into a "Más vistas ▾" dropdown. If the active view
 * lives in the dropdown, it is ALSO surfaced as a tab right after the
 * pinned ones (HubSpot-style) so the current view is always visible without
 * opening the dropdown.
 *
 * Deliberately generic over `key`/`label`/`href`/`active` — the caller
 * (page.tsx) builds one ViewTabItem per SYSTEM_VIEWS entry, the "outreach"
 * ranked tab, and each saved view, in the same order it renders today.
 */
export interface ViewTabItem {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** Only system views carry a count badge (mockup: "Todos los
   * contactos<span class='count'>16,642</span>"). */
  count?: number;
}

/** Owner-chosen pinned set — SYSTEM_VIEWS keys (src/lib/contacts/views.ts),
 * in the exact display order requested.
 *
 * `outreachReady` was swapped out for `moveToEmail` on 2026-09-28. Measured
 * against production that day: outreachReady returned 22 contacts while
 * moveToEmail returned 3,460 — the contacts already messaged on LinkedIn who
 * have a verified email, which is the segment the product strategy is about
 * (first touch on LinkedIn, then move to email or a call). A pinned slot
 * showing 22 rows while the largest actionable list sat behind the "Más
 * vistas" menu was backwards.
 *
 * The set stays at four. This row competes for horizontal width, and the
 * bulk actions bar on this same page had to gain `flex-wrap` the same day
 * after overflowing at 1024px — a fifth pinned tab invites the same bug.
 * `outreachReady` remains available in the overflow menu. */
export const PINNED_VIEW_TAB_KEYS: readonly string[] = ["all", "mine", "notContacted", "moveToEmail"];

export interface SplitViewTabsResult {
  pinned: ViewTabItem[];
  overflow: ViewTabItem[];
  /** The active item, only when it is NOT already in `pinned` — render it as
   * an extra tab right after `pinned` so the current view stays visible. */
  activeOverflowItem: ViewTabItem | null;
}

export function splitViewTabs(items: ViewTabItem[]): SplitViewTabsResult {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const pinned = PINNED_VIEW_TAB_KEYS.map((key) => byKey.get(key)).filter(
    (item): item is ViewTabItem => item !== undefined,
  );
  const pinnedKeys = new Set(pinned.map((item) => item.key));
  const overflow = items.filter((item) => !pinnedKeys.has(item.key));
  const activeOverflowItem = overflow.find((item) => item.active) ?? null;

  return { pinned, overflow, activeOverflowItem };
}
