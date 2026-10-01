import { decodeEntities } from "@/lib/gmail/htmlToText";

/**
 * Derives the text/plain alternative of an OUTGOING html message so callers
 * write the body once. Deliberately separate from `htmlToPlainText`
 * (inbound, htmlToText.ts): that one drops every link on purpose (XSS
 * surface when storing foreign mail); this one must KEEP links, because a
 * plain-text reader of our own mail has no other way to reach the URL.
 *
 * Handles: block elements -> newlines, <br>, <li> -> "- item", links ->
 * "text <url>" (http, https, mailto only), common entities, tag stripping.
 *
 * Does NOT handle: <pre> whitespace (all whitespace is collapsed), tables
 * (cells run together, rows become lines), images/alt text (dropped),
 * numbered list numbering (<ol> items render as "- "), nested lists
 * (no indentation), CSS-driven visibility, and named entities beyond
 * amp/lt/gt/quot/apos/nbsp plus numeric ones.
 */
const SAFE_HREF = /^(https?:|mailto:)/i;

export function htmlToOutboundText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    // Collapse source whitespace first (HTML semantics); only tags make breaks.
    .replace(/\s+/g, " ")
    .replace(
      /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, dq?: string, sq?: string, bare?: string, inner: string = "") => {
        const href = decodeEntities((dq ?? sq ?? bare ?? "").trim());
        const label = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
        if (!SAFE_HREF.test(href)) return label;
        const shown = href.replace(/^mailto:/i, "");
        if (!label || label === href || label === shown) return shown;
        // Sentinels, not "<" ">": the tag stripper below would eat them.
        return `${label} \u0002${href}\u0003`;
      },
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "\u0001- ")
    .replace(/<\/(p|h[1-6])\s*>/gi, "\n\n")
    // Soft break: adjacent open/close block tags collapse into ONE newline.
    .replace(/<\/?(div|tr|ul|ol|table|blockquote|hr|li|p|h[1-6])(?:\s[^>]*)?\/?>/gi, "\u0001")
    .replace(/<[^>]*>/g, "")
    .replace(/\u0001+/g, "\n");
  return decodeEntities(text)
    .replace(/\u0002/g, "<")
    .replace(/\u0003/g, ">")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
