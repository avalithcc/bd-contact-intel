/**
 * Builds the card's stylesheet FROM the CRM's own CSS so the two cannot drift: every design token declared on
 * `:root` in globals.css becomes a `:host` declaration (the card lives in a shadow root), and the component
 * rules the card uses (.btn, .badge, .alert, .avatar, .owner-chip, .skeleton, .help, .meta, .row, .grow, .icon)
 * are copied verbatim from globals.css and design-system.css. Media-query blocks and other at-rules are skipped
 * (the card is desktop-only); only the two keyframes the components animate with are kept.
 */
const COMPONENT_SELECTOR = /^\s*\.(btn|badge|alert|avatar|owner-chip|skeleton|help|meta|row|grow|icon)\b/;
const KEPT_KEYFRAMES = /^@keyframes\s+(ds-spin|ds-shimmer)\b/;

interface Rule {
  prelude: string;
  body: string;
}

/** Top-level rules of a stylesheet (nested blocks stay inside `body`). */
function topLevelRules(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let preludeStart = 0;
  let depth = 0;
  let bodyStart = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        // Statements such as `@import "x";` end with `;` before the next rule's selector, not with a block.
        const prelude = source.slice(preludeStart, bodyStart - 1).replace(/@[a-z-]+[^{;]*;/gi, "").trim();
        rules.push({ prelude, body: source.slice(bodyStart, i).trim() });
        preludeStart = i + 1;
      }
    }
  }
  return rules;
}

export function extractCardCss(globalsCss: string, designSystemCss: string): string {
  const tokens: string[] = [];
  const components: string[] = [];
  for (const rule of [...topLevelRules(globalsCss), ...topLevelRules(designSystemCss)]) {
    if (rule.prelude === ":root") {
      tokens.push(rule.body);
    } else if (rule.prelude.startsWith("@")) {
      if (KEPT_KEYFRAMES.test(rule.prelude)) components.push(`${rule.prelude} { ${rule.body} }`);
    } else if (rule.prelude.split(",").every((selector) => COMPONENT_SELECTOR.test(selector))) {
      components.push(`${rule.prelude} { ${rule.body} }`);
    }
  }
  return [`:host { ${tokens.join("\n")} }`, ...components].join("\n");
}
