/**
 * Background freshness of the authenticated shell. Changes made while a screen is open (cron sends of Sequences and
 * scheduled emails, Gmail sync replies, another BD's edits) must show up without a manual reload. One client component
 * (src/components/BackgroundRefresh.tsx) calls `router.refresh()`; this module is the pure decision of WHEN.
 *
 * Page conventions (plain data attributes anywhere in the page):
 *  - `data-refresh="off"`            the screen opts out of background refresh entirely.
 *  - `data-refresh-interval="180000"` a heavier screen asks for a longer interval (ms, at least MIN_INTERVAL_MS).
 *  - `data-dirty="true"`              unsaved input (composers, inline edits): the refresh waits, retrying on the next tick.
 *  - `data-busy="true"`               a write in flight.
 * An open `role="dialog"` / `aria-modal` / menu / listbox, or focus inside a field, also counts as busy.
 */

export const DEFAULT_INTERVAL_MS = 60_000;
/** Floor for a per-page hint: a typo can lengthen the interval, never turn it into a refresh storm. */
export const MIN_INTERVAL_MS = 30_000;
/** At most one wake (tab visible again / window focus) refresh per this window. */
export const DEBOUNCE_MS = 15_000;
/** How often the component re-evaluates the decision; a busy skip is retried at the next tick. */
export const TICK_MS = 15_000;

export interface RefreshInput {
  /** "tick" = the periodic timer; "wake" = the tab became visible or the window regained focus. */
  trigger: "tick" | "wake";
  now: number;
  lastRefreshAt: number;
  hidden: boolean;
  busy: boolean;
  optedOut: boolean;
  intervalMs: number;
}

export function shouldRefreshNow(i: RefreshInput): boolean {
  if (i.hidden || i.busy || i.optedOut) return false;
  const elapsed = i.now - i.lastRefreshAt;
  return i.trigger === "wake" ? elapsed >= DEBOUNCE_MS : elapsed >= i.intervalMs;
}

/** The slice of the DOM the policy reads, so it can be tested without one. */
export interface DomProbe {
  activeElement: { tagName: string; isContentEditable?: boolean; type?: string } | null;
  has(selector: string): boolean;
  attr(selector: string, name: string): string | null;
}

const BUSY_SELECTORS = ['[role="dialog"]', '[aria-modal="true"]', '[role="menu"]', '[role="listbox"]', '[data-busy="true"]', '[data-dirty="true"]'] as const;
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"]);

export function detectBusy(dom: DomProbe): boolean {
  if (BUSY_SELECTORS.some((s) => dom.has(s))) return true;
  const el = dom.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
}

export function readPageHints(dom: DomProbe): { optedOut: boolean; intervalMs: number } {
  const raw = Number(dom.attr("[data-refresh-interval]", "data-refresh-interval"));
  const intervalMs = Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
  return { optedOut: dom.has('[data-refresh="off"]'), intervalMs };
}

export function domProbe(doc: Document): DomProbe {
  return {
    activeElement: doc.activeElement as HTMLElement | null,
    has: (selector) => doc.querySelector(selector) !== null,
    attr: (selector, name) => doc.querySelector(selector)?.getAttribute(name) ?? null,
  };
}
