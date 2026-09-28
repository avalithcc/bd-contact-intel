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

/** Owner-chosen pinned set (2026, owner feedback round 18) — SYSTEM_VIEWS
 * keys (src/lib/contacts/views.ts), in the exact display order requested. */
export const PINNED_VIEW_TAB_KEYS: readonly string[] = ["all", "mine", "notContacted", "outreachReady"];

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
