import sanitizeHtml from "sanitize-html";

/**
 * Allowlist sanitizer for a BD's own pasted HTML email signature. The result
 * leaves over the BD's Gmail address to real clients, so nothing executable
 * or remote-loading beyond a plain https logo may survive.
 *
 * Library, not hand-rolled: `sanitize-html` (htmlparser2 underneath) parses
 * the markup the way a tolerant browser would, which is exactly where
 * regex/allowlist hand-rolls go wrong (nested `<scr<script>ipt>`, entity-
 * obfuscated schemes, unclosed tags). We only supply the policy below.
 *
 * Run it at save AND again when the signature is appended at send
 * (defence in depth, and it is idempotent: tests/unit/signatureSanitize).
 *
 * Policy:
 * - Tags: layout and text only (table family, p/div/span/br/hr, b/strong/
 *   em/i/u, font, headings, lists, a, img). Everything else is discarded;
 *   script/style/head/title/textarea content is dropped with the tag.
 * - Attributes: an explicit per-tag list. Every `on*` handler, `class`,
 *   `id`, `target` is gone because it is not listed.
 * - Links: http, https, mailto, tel. Images: https ONLY (a `data:` image is
 *   stripped by Gmail anyway; `http:` triggers mixed-content warnings).
 * - An image whose src was rejected is dropped. 1x1 / 0x0 images are dropped: that is a tracking pixel, never a logo.
 *   Other remote https images stay: a logo is the whole point, and the
 *   signature is the BD's own mail. Limit: a pixel sized with CSS only, or
 *   a 2x2 one, is not caught.
 * - Inline `style` is filtered per property AND per value, not allowed
 *   wholesale (see STYLE_VALUE).
 */
export const SIGNATURE_MAX_CHARS = 50_000;

const ALLOWED_TAGS = [
  "a", "img", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption",
  "br", "hr", "p", "div", "span", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup",
  "font", "center", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote",
];

const TABLE_ATTRS = ["width", "height", "align", "valign", "bgcolor", "border", "cellpadding", "cellspacing", "colspan", "rowspan"];

/**
 * A style value is a run of plain tokens, or an rgb()/rgba()/hsl()/hsla()
 * call with numeric arguments. Every other `(` is rejected, which removes
 * url(), expression(), calc(), var(), attr() and image-set() in one rule;
 * backslashes (CSS escapes such as `\75rl`), braces, angle brackets and
 * semicolons are outside the character set.
 */
const STYLE_VALUE = /^(?:[\w\s#.,%'"\-!/]|(?:rgba?|hsla?)\([\d\s.,%/]*\))+$/i;
const STYLE_PROPERTIES = [
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style",
  "text-decoration", "text-align", "text-transform", "vertical-align", "line-height", "letter-spacing",
  "white-space", "width", "height", "max-width", "min-width", "border-collapse", "border-spacing",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-style",
  "border-width", "border-radius", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
];
// Deliberately absent: position/top/left/z-index/float (overlay and
// click-jack tricks), background/background-image (url()), behavior,
// -moz-binding, filter, content, display (hiding text from the reader).

const ALLOWED_STYLES = Object.fromEntries(STYLE_PROPERTIES.map((p) => [p, [STYLE_VALUE]]));

/** Browsers ignore tab/CR/LF inside URLs; strip them so no control char survives. */
const URL_CONTROL = /[\u0000-\u001f\u007f]/g;

function isTrackingPixel(attribs: Record<string, string>): boolean {
  return ["width", "height"].some((name) => {
    const raw = attribs[name];
    if (raw === undefined) return false;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n <= 1;
  });
}

export function sanitizeSignatureHtml(input: string): string {
  const out = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "name"],
      img: ["src", "alt", "title", "width", "height", "align", "border"],
      font: ["color", "size", "face"],
      table: TABLE_ATTRS,
      tr: TABLE_ATTRS,
      td: TABLE_ATTRS,
      th: TABLE_ATTRS,
      col: TABLE_ATTRS,
      div: ["align"],
      p: ["align"],
      "*": ["style"],
    },
    allowedStyles: { "*": ALLOWED_STYLES },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    nonTextTags: ["script", "style", "textarea", "option", "head", "title", "noscript", "template"],
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: cleanUrls(attribs) }),
      img: (tagName, attribs) => ({ tagName, attribs: cleanUrls(attribs) }),
    },
    exclusiveFilter: (frame) => frame.tag === "img" && (!frame.attribs.src || isTrackingPixel(frame.attribs)),
  });
  return out.trim();
}

function cleanUrls(attribs: Record<string, string>): Record<string, string> {
  const next = { ...attribs };
  for (const key of ["href", "src"]) {
    if (next[key] !== undefined) next[key] = next[key].replace(URL_CONTROL, "");
  }
  return next;
}
