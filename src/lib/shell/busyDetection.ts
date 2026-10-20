/**
 * Is the screen mid-edit? A live refresh (src/components/LiveUpdates.tsx) is held back while it is, so the data under a
 * form never changes while someone types. `router.refresh()` keeps client state, so it would not close a dialog; the
 * hold is about not shifting rows under the user.
 *
 * Page conventions (plain data attributes anywhere in the page):
 *  - `data-dirty="true"`  unsaved input (composers, inline edits).
 *  - `data-busy="true"`   a write in flight.
 * An open `role="dialog"` / `aria-modal` / menu / listbox, or focus inside a field, also counts as busy.
 */

/** The slice of the DOM the detection reads, so it can be tested without one. */
export interface DomProbe {
  activeElement: { tagName: string; isContentEditable?: boolean; type?: string } | null;
  has(selector: string): boolean;
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

export function domProbe(doc: Document): DomProbe {
  return {
    activeElement: doc.activeElement as HTMLElement | null,
    has: (selector) => doc.querySelector(selector) !== null,
  };
}
