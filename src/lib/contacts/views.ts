/**
 * System views for the `/contacts` list (task 12.2; design D7: "System
 * views are code constants ... BD-created views go in the `saved_view`
 * table"). These are the fixed replacements for the former per-BD outreach
 * and hiring lists (design.md "Outreach -> saved views"; contact-list spec
 * "Central list, no per-BD scoping").
 */
import type { ContactFilters } from "@/lib/contacts/viewFilters";

export type SystemViewKey =
  | "all"
  | "mine"
  | "notContacted"
  | "newVerified"
  | "hiring"
  | "outreachReady";

export interface SystemView {
  key: SystemViewKey;
  filters: ContactFilters;
}

export const SYSTEM_VIEWS: readonly SystemView[] = [
  { key: "all", filters: {} },
  { key: "mine", filters: { owner: "me" } },
  { key: "notContacted", filters: { status: ["new"] } },
  { key: "newVerified", filters: { status: ["new"], emailVerified: true } },
  { key: "hiring", filters: { hiring: true } },
  {
    key: "outreachReady",
    filters: { status: ["new"], emailVerified: true, hiring: true },
  },
];

export const DEFAULT_SYSTEM_VIEW_KEY: SystemViewKey = "all";

const SYSTEM_VIEW_KEYS: readonly string[] = SYSTEM_VIEWS.map((v) => v.key);

export function isSystemViewKey(value: string): value is SystemViewKey {
  return SYSTEM_VIEW_KEYS.includes(value);
}

export function systemViewFilters(key: SystemViewKey): ContactFilters {
  return SYSTEM_VIEWS.find((v) => v.key === key)?.filters ?? {};
}

const SAVED_VIEW_PREFIX = "saved:";

export interface ActiveViewSavedInput {
  id: string;
  name: string;
  filters: ContactFilters;
}

export interface ActiveView {
  // "saved" viewKey is the literal `?view=saved:<id>` query value, so tabs
  // and the active-tab check can round-trip it directly.
  viewKey: string;
  filters: ContactFilters;
  isSaved: boolean;
  savedViewId: string | null;
  savedViewName: string | null;
}

/**
 * Resolves the `?view=` query param against the system views and a BD's own
 * saved views (design.md "Routes": "`?view=`... live in the query string").
 * An unrecognized or missing value falls back to the default system view —
 * never throws, since this reads directly off user-controlled query params.
 */
export function resolveActiveView(
  viewParam: string | undefined,
  savedViews: readonly ActiveViewSavedInput[],
): ActiveView {
  if (viewParam?.startsWith(SAVED_VIEW_PREFIX)) {
    const id = viewParam.slice(SAVED_VIEW_PREFIX.length);
    const saved = savedViews.find((v) => v.id === id);
    if (saved) {
      return {
        viewKey: viewParam,
        filters: saved.filters,
        isSaved: true,
        savedViewId: saved.id,
        savedViewName: saved.name,
      };
    }
  }

  const key = viewParam && isSystemViewKey(viewParam) ? viewParam : DEFAULT_SYSTEM_VIEW_KEY;
  return {
    viewKey: key,
    filters: systemViewFilters(key),
    isSaved: false,
    savedViewId: null,
    savedViewName: null,
  };
}
