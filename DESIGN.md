---
version: alpha
name: Avalith-bd-contact-intel-design
description: "Adapted from awesome-design-md's Linear DESIGN.md (https://github.com/VoltAgent/awesome-design-md, design-md/linear.app/DESIGN.md). STRUCTURE only — color roles, type scale, spacing scale, radii, elevation, component specs and states — is taken from the Linear source. Every color, font, and mark is Avalith's own: a near-black canvas (#0b0a11) with a two-step surface lift, Avalith red (#d5252f) as the single chromatic accent (replacing Linear's lavender-blue), Inter for body/display and JetBrains Mono for mono/eyebrow labels, and the 'avalith.' wordmark with its signature red trailing dot. Reference implementation: src/app/globals.css."

colors:
  accent: "#d5252f"
  accent-hover: "#e6434c"
  accent-focus: "#b81f27"
  ink: "#ffffff"
  ink-soft: "#8e8c99"
  ink-muted: "#56545f"
  canvas: "#0b0a11"
  surface-1: "#0e0d15"
  surface-2: "#131119"
  surface-tint: "#1d1215"
  border: "rgba(255,255,255,0.08)"
  border-strong: "rgba(255,255,255,0.18)"
  semantic-success: "#3ecf8e"
  semantic-warn: "#e6a23c"
  semantic-danger: "#ff6b6b"

colors-light:
  accent: "#d5252f"
  accent-hover: "#e6434c"
  accent-focus: "#b81f27"
  ink: "#17151c"
  ink-soft: "#5b5865"
  ink-muted: "#8b8894"
  canvas: "#f5f4f7"
  surface-1: "#fbfafc"
  surface-2: "#ffffff"
  surface-tint: "#f3e9ea"
  border: "rgba(0,0,0,0.08)"
  border-strong: "rgba(0,0,0,0.16)"
  semantic-success: "#15803d"
  semantic-warn: "#b45309"
  semantic-danger: "#dc2626"

typography:
  h1:
    fontFamily: Inter
    fontSize: 1.6rem
    fontWeight: 800
    letterSpacing: -0.02em
  h2:
    fontFamily: Inter
    fontSize: 1.15rem
    fontWeight: 800
    letterSpacing: -0.01em
  logo:
    fontFamily: Inter
    fontSize: 1.05rem
    fontWeight: 800
    letterSpacing: -0.02em
  body:
    fontFamily: Inter
    fontSize: 0.9rem
    fontWeight: 400
  body-sm:
    fontFamily: Inter
    fontSize: 0.85rem
    fontWeight: 400
  caption:
    fontFamily: Inter
    fontSize: 0.78rem
    fontWeight: 400
  micro:
    fontFamily: Inter
    fontSize: 0.72rem
    fontWeight: 400
  eyebrow:
    fontFamily: JetBrains Mono
    fontSize: 0.72rem
    fontWeight: 700
    letterSpacing: 0.04em
  mono:
    fontFamily: JetBrains Mono
    fontSize: 0.78rem
    fontWeight: 400

rounded:
  sm: 6px
  md: 8px
  pill: 999px

spacing:
  2xs: 0.35rem
  xs: 0.4rem
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.25rem
  2xl: 1.5rem
  3xl: 1.75rem

components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 0.55rem 1.1rem
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-focus}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 0.55rem 1.1rem
    border: 1px solid {colors.border-strong}
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-soft}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 1.15rem 1.35rem
    border: 1px solid {colors.border}
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    border: 1px solid {colors.border}
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 0.55rem 0.7rem
    border: 1px solid {colors.border}
  badge:
    backgroundColor: rgba(213,37,47,0.12)
    textColor: "{colors.accent}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: 0.12rem 0.55rem
  chip:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 0.28rem 0.4rem 0.28rem 0.7rem
    border: 1px solid {colors.border}
  dropdown-menu:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    border: 1px solid {colors.border-strong}
---

## Overview

This is Avalith's design system for `bd-contact-intel`, restructured on top of the **Linear** system from awesome-design-md — color roles, type/spacing scale, radii, elevation, and component states are adapted from that source. Every visible color, font, and brand mark is Avalith's own; nothing from Linear's palette or type family survives.

The app is a dense, dark, data-first internal tool (a Business Developer contact base) — closer in spirit to Linear's own *product* surface than to Linear's marketing site, so structure was pulled from Linear's spec but scaled down: no 80px display type, no product-screenshot hero cards, no 96px section rhythm. Instead the scale is compressed to match a table-and-form-heavy internal app.

**Key characteristics:**
- **Near-black canvas** (`--color-canvas` #0b0a11) with a two-step surface lift (`--color-surface-1` → `--color-surface-2`), not Linear's four-step ladder — this app doesn't need that much depth.
- **Avalith red** (`--color-accent` #d5252f) is the single chromatic accent — brand mark, eyebrow labels, links, focus rings, primary buttons — mirroring how sparingly Linear uses its lavender.
- **Inter** carries every text role (headings, body, buttons); **JetBrains Mono** is reserved for the `// eyebrow` labels, badges, and a few mono status strings — same "mono only in taxonomy contexts" principle as Linear.
- Semantic colors (`success`, `warn`, `danger`) are kept **distinct from the brand accent**, exactly as Linear keeps its green separate from lavender.
- Cards/panels use 6–8px radii and 1px hairline borders — no shadow-driven elevation except the one dropdown menu.

## Brand facts used (source: `/Users/cristiancivita/avalith/contexto/`)

- `contexto/empresa.md` does not document any color, font, or logo facts — it's company/business context (services, clients, positioning), not a brand-asset file. **No conflicting or confirming brand facts were found there.**
- The actual brand source of truth is the code already in production: `src/app/globals.css` (`:root` tokens) and `src/app/layout.tsx` (font loading). Per this repo's own `CLAUDE.md`, anything not confirmed by Cristian or a cited source should be flagged `(?)` — so: **the red hex `#d5252f`, the dark palette, and the Inter/JetBrains Mono pairing are taken as given because they are the live, shipped brand (not merely a claim in `contexto/`) `(?)` no separate brand-guideline doc was found to cite.**

## Color Palette & Roles

| Token | Hex / Value | Role |
|---|---|---|
| `--color-canvas` | `#0b0a11` | Page background |
| `--color-surface-1` | `#0e0d15` | Cards, import blocks, table hover rows' containers, dropdown menu |
| `--color-surface-2` | `#131119` | Panels (the main content container level) |
| `--color-surface-tint` | `#1d1215` | Reserved — the "offshore" signal badge only, not general surface use |
| `--color-accent` | `#d5252f` | Brand mark, eyebrow, links, focus, primary buttons, active states |
| `--color-accent-hover` | `#e6434c` | Hover state of accent-colored buttons/links |
| `--color-accent-focus` | `#b81f27` | Active/pressed state and the focus-visible ring color |
| `--color-ink` | `#ffffff` | Primary text, headings |
| `--color-ink-soft` | `#8e8c99` | Secondary text, labels, nav links |
| `--color-ink-muted` | `#56545f` | Tertiary/disabled text |
| `--color-border` | `rgba(255,255,255,.08)` | Default hairline borders |
| `--color-border-strong` | `rgba(255,255,255,.18)` | Emphasized borders — secondary buttons, dropdown, active tabs |
| `--color-success` | `#3ecf8e` | "Hiring" / positive badges |
| `--color-warn` | `#e6a23c` | Non-blocking warnings (e.g. upload sender-detection notices) |
| `--color-danger` | `#ff6b6b` | Form/import errors — intentionally distinct from the brand accent red |

Dark is the default palette above (`:root`, unauthenticated/no-cookie visitors and `theme=dark` see this unchanged). The light palette — same roles, different values — is documented in **Theming** below.

## Theming

The app ships three themes: **Light**, **Dark** (the original, still the fallback for anyone without a saved preference) and **System** (follows the OS/browser preference). Implementation:

- **Preference storage:** a `theme` cookie (`light | dark | system`; missing/invalid → `dark`), set via a `"use server"` action (`src/lib/theme/actions.ts`) invoked by a plain `<form>` POST — no client JS required to switch themes, same pattern as the locale switcher (`src/lib/i18n/`).
- **SSR, no flash:** `src/app/layout.tsx` reads the cookie server-side (`getTheme()`) and sets `data-theme="light"` / `data-theme="dark"` on `<html>` before any paint. For `system` it omits the attribute entirely, deferring to CSS. `color-scheme` is set alongside so native controls/scrollbars match.
- **CSS activation (`src/app/globals.css`):** `:root` holds the dark values (the default token set). A `[data-theme="light"]` selector and an `@media (prefers-color-scheme: light) { :root:not([data-theme]) { ... } }` block both activate the light palette — but neither hardcodes it a second time: the actual light hex/rgba values are defined exactly **once**, as a `--light-*` constant set inside `:root` (e.g. `--light-canvas`, `--light-ink-soft`), and both trigger rules just repoint the real `--color-*` tokens at those constants. Edit a light value once; both triggers stay in sync.
- **UI:** `ThemeSwitcher` (`src/lib/theme/ThemeSwitcher.tsx`) — three segmented buttons (Light/Dark/System), same visual language as `LocaleSwitcher` — rendered in the `UserMenu` dropdown below the language switcher, on every authenticated page. Login and account/password pages have no switcher (they still respect the cookie/system default).

### Light Palette & Roles

| Token | Hex / Value | Role (same as the dark-theme row above) |
|---|---|---|
| `--color-canvas` (light) | `#f5f4f7` | Page background — near-white, not pure white |
| `--color-surface-1` (light) | `#fbfafc` | Cards, import blocks, table hover rows' containers, dropdown menu |
| `--color-surface-2` (light) | `#ffffff` | Panels (main content container) — the brightest/most prominent surface, mirroring how `surface-2` is the brightest step in dark |
| `--color-surface-tint` (light) | `#f3e9ea` | Offshore badge only, same as dark's role |
| `--color-ink` (light) | `#17151c` | Primary text, headings |
| `--color-ink-soft` (light) | `#5b5865` | Secondary text, labels — **~6.9:1 contrast on white** (AA requires 4.5:1) |
| `--color-ink-muted` (light) | `#8b8894` | Tertiary/disabled text (no AA requirement — see Do/Don't) |
| `--color-border` (light) | `rgba(0,0,0,.08)` | Default hairline borders |
| `--color-border-strong` (light) | `rgba(0,0,0,.16)` | Emphasized borders |
| `--color-success` (light) | `#15803d` | **~5.0:1 on white** (the dark-theme `#3ecf8e` is only ~2.0:1 on white — fails AA, so light gets its own darker green) |
| `--color-warn` (light) | `#b45309` | **~5.0:1 on white** (dark-theme `#e6a23c` is ~2.2:1 — fails AA) |
| `--color-danger` (light) | `#dc2626` | **~4.8:1 on white** (dark-theme `#ff6b6b` is ~2.8:1 — fails AA) |

`--color-accent` (`#d5252f`) is **unchanged** across themes — it measures ~5.1:1 on white, comfortably clearing AA (4.5:1) for normal text, so the same brand red serves as fill, link, and focus color in both themes. No separate light-theme accent was needed.

Two more tokens are theme-aware: `--shadow-dropdown` (a lighter, softer shadow in light — the dark theme's `rgba(0,0,0,.35)` reads as a heavy smudge on a near-white canvas) and `--icon-select-chevron` (the select's chevron is a data-URI SVG with its stroke color baked in, so it can't use `currentColor`; the whole `background-image` is a token, re-pointed at a same-shaped SVG using the light-theme `ink-soft` hex). `--color-row-hover` and the two badge-tint tokens (`--color-badge-accent-bg`, `--color-badge-success-bg`) keep the **same** rgba value in both themes — a translucent tint composited over either a near-black or near-white surface stays legible on its own, so no override was needed; they were tokenized anyway so no rgba literal remains inline in a component rule.

## Typography

- **Body/display family:** Inter (400/500/600/700/800), loaded via `next/font/google` in `src/app/layout.tsx` as `--font-inter`.
- **Mono family:** JetBrains Mono (400/700), loaded via `next/font/google` in `src/app/layout.tsx` as `--font-jetbrains`, then consumed by the `--font-mono` token (`--font-mono: var(--font-jetbrains), ...`). It is named `--font-jetbrains` rather than `--font-mono` specifically to avoid a self-referential custom property — `--font-mono: var(--font-mono), ...` is invalid CSS and silently drops the whole declaration. Used only for the `// eyebrow` label, badges, and mono status strings — never for body copy.
- No Linear typefaces are used anywhere.

| Token | Size | Weight | Use |
|---|---|---|---|
| `h1` | 1.6rem | 800 | Page title, carries the trailing red dot |
| `h2` | 1.15rem | 800 | Section title |
| `logo` | 1.05rem | 800 | "avalith." wordmark |
| `body` | 0.9rem | 400 | Table cells, message content |
| `body-sm` | 0.85rem | 400 | Buttons, form inputs, panel copy |
| `caption` | 0.78rem | 400 | Chips, thread meta, table headers |
| `micro` | 0.72rem | 400/700 | Badges, table header letter-spacing |
| `eyebrow` | 0.72rem | 700 mono | `// section` label, red, uppercase-tracking |
| `mono` | 0.78rem | 400 mono | Sync-status line, thread notice |

**Brand pattern (non-negotiable, unchanged):** lowercase page titles with a trailing `<span class="dot">.</span>` in accent red; `// eyebrow` mono labels in accent red above every section.

## Components

### Buttons
- **Primary** (bare `<button>`): background `--color-accent`, white text, `border-radius: 6px`. Hover → `--color-accent-hover`. Active/pressed → `--color-accent-focus`. Disabled → `opacity: .55`.
- **Secondary** (`button.secondary`): `--color-surface-1` background, `--color-ink-soft` text, `--color-border-strong` border. Hover → text goes to `--color-ink`, border to `--color-accent`.
- **Ghost** (`.ghost`, new): transparent background, `--color-ink-soft` text, no border. Hover → `--color-surface-1` background, `--color-ink` text. Not wired into any screen yet — available for future row-level actions.
- **Link-as-button** (`.secondary-btn`): same visual spec as `button.secondary` but for `<Link>` nav items (e.g. header nav, "back"). Has a `.disabled` and an `.active` (locale switcher) modifier.

### Inputs & Selects
- `input[type=text|password|file]` and `select` (select styling added in this pass — it was previously unstyled and fell back to the browser default) share one spec: `--color-canvas` background, 1px `--color-border`, `border-radius: 6px`, `--color-ink` text. Hover → border brightens to `--color-border-strong`. Focus → border to `--color-accent`. Disabled → `opacity: .55`.
- Every control in a filter row — text input, select, submit button, checkbox row — is exactly `--control-height` (2.5rem) tall, so toolbars align on one line. Selects use `appearance: none` with a custom chevron; never rely on native select metrics. File inputs are the only exception (natural height).
- Checkboxes in a filter toolbar never take a slot of their own: they stack in one `.filter-checkbox-group` column at the end of the row, next to the submit button. Keep their labels short (2–4 words).
- Checkboxes use `accent-color: var(--color-accent)` (native control tinting, no custom widget).

### Tables
- Borderless rows separated by 1px `--color-border` bottom rules; header row in `--color-ink-soft`, `micro` size, uppercase-style tracking. Row hover tints the cell background by `rgba(255,255,255,.02)`.

### Badges
- Base `.badge`: pill, mono, 700 weight, `rgba(accent, .12)` background, accent text.
- `.badge.green` / `.badge.hiring`: success green on translucent green.
- `.badge.offshore`: the one deliberate exception — uses `--color-surface-tint` + `--color-ink-soft`, never red or green, because it's a neutral factual signal, not a positive or negative one (see the code comment on `.badge.offshore` in `globals.css`).

### Panels / Cards
- `.panel`: the primary content container — `--color-surface-2`, 1px border, 8px radius.
- `.import-block`, `.filter-helper`, `.whats-new-company`, `.thread`: secondary containers at `--color-surface-1`, same border/radius language, used for collapsible or nested content.

### Navigation
- `.header`: flex row, logo left, actions right (nav links as `.secondary-btn`, then `.user-menu`).
- `.user-menu`: icon trigger (`.user-menu-trigger`) opening a `.user-menu-dropdown` — `--color-surface-1`, `--color-border-strong` border, drop shadow (`--shadow-dropdown`), containing the account name, locale switcher, "change password" and sign-out.

### Dropdown Menu
- `.user-menu-dropdown` is the one component with a drop shadow (`0 8px 24px rgba(0,0,0,.35)`) — otherwise the system relies on surface contrast, not shadows, for elevation.

### Chips
- `.chip`: pill, `--color-surface-1`, 1px `--color-border`, used for active-filter chips (each with an inline `×` remove link) and, via `.reason-chips`, for outreach ranking-reason badges.

## Layout / Spacing

- **Base unit:** loosely 4px, expressed as a rem-based scale: `2xs 0.35rem · xs 0.4rem · sm 0.5rem · md 0.75rem · lg 1rem · xl 1.25rem · 2xl 1.5rem · 3xl 1.75rem`.
- **Page container:** `main` caps at `1040px`, centered, `2.5rem 1.5rem 4rem` padding. Auth/detail pages narrow this locally (`.form-narrow` 400px, `.detail-narrow` 720px).
- **Section rhythm:** panels/cards stack with `2xl` (1.5rem) bottom margin; the page header sits `3xl` (1.75rem) above content.
- **Utility classes** (new, in `globals.css`): `.m-0/.mt-0/.mb-0`, `.mt-2xs/.mt-md/.mt-xl`, `.mb-md/.mb-lg/.mb-2xl/.mb-3xl`, `.ml-sm`, `.row-md/.row-xs` (gap modifiers on `.row`), `.field-grow`, `.form-narrow/.detail-narrow`, `.inline-block`, `.text-danger/.text-warn`. These replace one-off inline `style={{...}}` spacing that used to live in `src/app/**/*.tsx`.

## Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No shadow, no border | Body text, page background |
| 1 (surface-1) | `--color-surface-1` + 1px `--color-border` | Cards, import/filter-helper blocks, table-adjacent panels |
| 2 (surface-2) | `--color-surface-2` + 1px `--color-border` | Primary `.panel` containers |
| 3 (dropdown) | `--color-surface-1` + `--color-border-strong` + `--shadow-dropdown` | User menu — the only shadow in the system |
| 4 (focus) | 2px `--color-accent-focus` outline, 2px offset | `:focus-visible` on any interactive element |

No gradients, no glow, no multi-layer shadows — matching Linear's "surface ladder + hairline, resist drop shadows" principle.

## Do's and Don'ts

### Do
- Reserve `--color-accent` (red) for brand mark, eyebrow, links, primary actions, and focus — never as a body/section background.
- Use the two-step surface ladder for hierarchy (`canvas` → `surface-1` → `surface-2`); don't skip straight to `surface-2` for a nested card.
- Keep semantic colors (`success`/`warn`/`danger`) separate from the brand accent, even though both the accent and `danger` are red-family — they must never be swapped for each other.
- Keep mono (JetBrains Mono) scoped to eyebrows, badges, and status strings.
- Add real hover/active/disabled/focus-visible states to any new interactive element — don't ship a control with only a default state.

### Don't
- Don't introduce a second chromatic accent color for anything decorative.
- Don't use `--color-surface-tint` (the offshore-badge warm tone) as a general surface — it is a single-purpose neutral signal color.
- Don't add drop shadows outside the dropdown menu.
- Don't hardcode hex colors, spacing, or radii in component CSS — consume the tokens in `:root`.
- Don't reach for inline `style={{...}}` for spacing/layout that a utility class already covers.
- **Never hardcode a color outside the token layer.** Every hex/rgba value belongs in `:root` (or a `--light-*` constant referenced by the theme-activation rules) in `src/app/globals.css` — never inline in a component rule, never in a TSX `style={{}}`, never baked into an SVG's `stroke`/`fill` (use `currentColor`, or — if the icon is a data-URI that can't use `currentColor` — put the whole `background-image`/`mask-image` behind a token and give it a light-theme override, as `--icon-select-chevron` does).

## Responsive

- Single breakpoint at `560px` (mobile): filter toolbars, checkbox rows, and the what's-new toolbar switch from row to stacked `flex-direction: column`; `.example-list`'s CSS columns collapse to 1.
- No separate tablet breakpoint — the 1040px-capped container reflows directly from desktop to the 560px mobile stack.
- Table wrappers (`.table-wrap`) scroll horizontally rather than reflow columns.

## Agent Prompt Guide

When extending this UI:
1. Reach for an existing class first (`.panel`, `.badge`, `.chip`, `.secondary-btn`, `.filter-*`) before writing new CSS.
2. If a new value is needed, add it as a token in `:root` (color/spacing/radius) rather than a hardcoded value in a rule.
3. Any new interactive element needs `:hover`, `:disabled` (if applicable), and relies on the global `:focus-visible` rule — don't override focus-visible per component unless the default 2px accent-focus ring is genuinely wrong for that control.
4. Spacing in JSX belongs in a utility class (see the "Layout / Spacing" utility list above), not `style={{}}` — add a new utility to `globals.css` if the scale doesn't already cover the value you need.
5. Never introduce a second chromatic accent, a drop shadow, or a font outside Inter/JetBrains Mono.
6. Keep `.badge.offshore` semantics intact: it is neither positive (green) nor negative (red) — a new "neutral factual signal" badge should follow its pattern, not invent a third color.
