/**
 * The one "wait for the page to change" primitive of the content script: resolves when `isDone()` turns true after
 * a DOM mutation, or when `timeoutMs` passes. It resolves either way and never rejects. The observer and the timer
 * come from the document's own window so the same code runs in a real tab and in a test document.
 */
export function waitForDom(
  doc: Document,
  view: Window & typeof globalThis,
  isDone: () => boolean,
  timeoutMs: number,
  afterObserve?: () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const observer = new view.MutationObserver(() => {
      if (isDone()) finish();
    });
    const timer = view.setTimeout(finish, timeoutMs);
    function finish() {
      observer.disconnect();
      view.clearTimeout(timer);
      resolve();
    }
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    afterObserve?.();
  });
}
