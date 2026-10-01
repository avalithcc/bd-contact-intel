/**
 * Converts an HTML email body to plain text. We do NOT store HTML at all
 * (fresh-review fix, 2026-09-30): the previous `sanitizeHtml` allow-list
 * approach (strip `<script>`/`<style>`, strip `on*` attributes) is
 * bypassable — unquoted `onclick=x()` handlers, `javascript:` URIs in
 * `href`/`src`, and `<svg onload=...>` all survive that kind of regex
 * denylist. Stripping every tag unconditionally and keeping only the text
 * content removes the XSS surface entirely rather than trying to filter it,
 * so there is nothing left to bypass.
 *
 * Used only when a message has no text/plain part at all
 * (src/lib/gmail/parseMessage.ts) — text/plain is always preferred as-is.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => NAMED_ENTITIES[name] ?? `&${name};`);
}

export function htmlToPlainText(html: string): string {
  const withoutHead = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const withLineBreaks = withoutHead
    .replace(/<br\s*\/?>/gi, "\n")
    // Both the opening AND closing tag of a block-level element become a
    // line break, so `<p>a</p><p>b</p>` reads as two lines, not one.
    .replace(/<\/?(p|div|tr|li|h[1-6])(?:\s[^>]*)?>/gi, "\n")
    // Every remaining tag (including any we didn't special-case above, e.g.
    // <svg>, <img>, <a href="javascript:...">) is stripped, not filtered —
    // its attributes never reach the output at all.
    .replace(/<[^>]*>/g, "");
  const decoded = decodeEntities(withLineBreaks);
  return decoded
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
