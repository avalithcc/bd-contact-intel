/**
 * Whether the page read that "Agregar al CRM" started may still be sent to the CRM.
 *
 * The read is awaited — it waits for the top card and for the lazy Experience section — and LinkedIn
 * navigates as an SPA, so the tab can land on another profile while it runs. The URL that leaves for the
 * CRM is captured BEFORE that await (card.ts passes the profile the BD clicked on), so sending an answer
 * that was read after a move would file one profile's text under another profile's URL: the same class of
 * defect as reading a person's name from the previous page's tab title.
 *
 * Pure, no DOM and no chrome.*, the same convention as profileUrl.ts and domWait.ts, so the rule is
 * testable without a browser.
 */

export interface ReadOrigin {
  /** `generation` when the read started. It is bumped on every profile change. */
  startedGeneration: number;
  /** `generation` now, once the read has resolved. */
  currentGeneration: number;
  /** The canonical profile URL the read started on — the one that would be sent. */
  startedUrl: string;
  /** The canonical profile URL the tab is on now; null when it is not on a profile page at all. */
  currentUrl: string | null;
}

/**
 * Both conditions are required and neither implies the other:
 *
 * - The tab can move away and back to the SAME profile (back/forward, or a re-entry from search). The URL
 *   then matches while the card the read was started for has already been unmounted and re-created, so the
 *   generation is what catches it.
 * - `sync()` can still be pending when the read resolves — it runs on the Navigation API event, or on a 1s
 *   interval where that is missing. The generation is then still current while the tab has already moved,
 *   so the URL is what catches it.
 *
 * When this returns false the read is simply dropped: `sync()` has already started, or is about to start,
 * a fresh lookup for whatever profile the tab is on now.
 */
export function readMayBeSent(origin: ReadOrigin): boolean {
  return origin.startedGeneration === origin.currentGeneration && origin.currentUrl === origin.startedUrl;
}
