/**
 * The worker answers only this extension's own content script running on www.linkedin.com. Chrome already
 * limits `runtime.onMessage` to the extension's own contexts (nothing external is declared), so this is a
 * second lock: the sender must carry this extension's id AND be a page on the LinkedIn host.
 */
export function isTrustedSender(
  sender: { id?: string; url?: string; tab?: { url?: string } },
  runtimeId: string,
): boolean {
  if (!sender.id || sender.id !== runtimeId) return false;
  const raw = sender.url ?? sender.tab?.url;
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "www.linkedin.com";
  } catch {
    return false;
  }
}
