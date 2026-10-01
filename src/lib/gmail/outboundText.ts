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

/**
 * Elements the HTML reader never sees must not appear in the text part
 * (hidden preheaders are normal in HTML mail). Catches ONLY: the `hidden`
 * attribute, and an inline `style` with `display:none` or
 * `visibility:hidden`, along with everything nested inside such an element.
 * Does NOT catch: class- or id-based rules in a <style> block or stylesheet,
 * `opacity:0`, `font-size:0`, `max-height:0`, `mso-hide:all`, off-screen
 * positioning, same-colour text, or a child overriding `visibility:visible`
 * inside a `visibility:hidden` parent (it stays dropped).
 */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i;

function isHidden(attrs: string): boolean {
  const style = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (style && HIDDEN_STYLE.test(style[1] ?? style[2] ?? style[3] ?? "")) return true;
  // Quoted values removed first so `title="hidden"` or a style value never match.
  const bare = attrs.replace(/"[^"]*"|'[^']*'/g, '""');
  return /\shidden(?=[\s=/]|$)/i.test(bare);
}

function stripHiddenElements(html: string): string {
  let out = "";
  let last = 0;
  let skipName: string | null = null;
  let depth = 0;
  for (const m of html.matchAll(TAG)) {
    const [tag, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    const end = m.index + tag.length;
    const selfClosing = VOID.has(name) || /\/\s*$/.test(attrs);
    if (skipName === null) {
      if (closing || !isHidden(attrs)) continue;
      out += html.slice(last, m.index);
      last = end;
      if (!selfClosing) {
        skipName = name;
        depth = 1;
      }
    } else if (name === skipName && !selfClosing) {
      depth += closing ? -1 : 1;
      if (depth === 0) {
        skipName = null;
        last = end;
      }
    }
  }
  // An unclosed hidden element hides the rest of the document, as in a browser.
  return skipName === null ? out + html.slice(last) : out;
}

export function htmlToOutboundText(html: string): string {
  const text = stripHiddenElements(
    html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ""),
  )
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
