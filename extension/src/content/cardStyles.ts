/**
 * Card-specific rules from the approved mockup (.xcard, .xpill, ...), written ONLY in design tokens. They are
 * appended to the component rules extracted from the CRM's CSS (extension/build/extractCardCss.ts), so the card
 * looks like the CRM without sharing a single selector with LinkedIn's page: it lives in a shadow root.
 */
export const CARD_LOCAL_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.xcard, .xpill { font-family: var(--font-body); font-size: var(--text-sm); line-height: 1.4; color: var(--color-ink); }
.xcard p { margin: 0; }
.xcard { position: fixed; top: 84px; right: var(--space-lg); z-index: 2147483000; width: 300px; background: var(--color-surface-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-dropdown); }
.xcard-head { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border-bottom: 1px solid var(--color-border); }
.xcard-head strong { flex: 1; font-size: var(--text-sm); }
.xcard-body { padding: var(--space-md); display: grid; gap: var(--space-sm); }
.xcard .btn { justify-content: center; }
.btn-block { width: 100%; }
.btn:focus-visible, .xpill:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.xmark { flex: none; display: grid; place-items: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--color-accent); color: var(--color-ink); font-weight: 800; font-size: var(--text-sm); line-height: 1; }
.xpill { position: fixed; top: 84px; right: var(--space-lg); z-index: 2147483000; display: inline-flex; align-items: center; gap: var(--space-xs); padding: var(--space-2xs) var(--space-md) var(--space-2xs) var(--space-2xs); background: var(--color-surface-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-pill); box-shadow: var(--shadow-dropdown); font-weight: 600; cursor: pointer; }
.xpill .dotstate { width: 8px; height: 8px; border-radius: 50%; background: var(--color-ink-muted); }
.xpill .dotstate.success { background: var(--color-success); }
.xmeta { display: grid; gap: var(--space-2xs); }
.xmeta .k { color: var(--color-ink-subtle); font-size: var(--text-xs); }
.stack-sm { display: grid; gap: var(--space-sm); }
.spin { width: 14px; height: 14px; border: 2px solid var(--color-border-strong); border-top-color: var(--color-ink); border-radius: 50%; animation: ds-spin 0.9s linear infinite; display: inline-block; }
.skeleton { display: block; }
.skeleton.w-70 { width: 70%; }
.skeleton.w-50 { width: 50%; }
.alert { font-size: var(--text-sm); padding: var(--space-sm) var(--space-md); }
`;
