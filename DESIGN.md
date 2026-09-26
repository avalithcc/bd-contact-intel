---
version: beta
name: Avalith-bd-contact-intel-design
description: "Light-only theme with vibrant semantic colors. Avalith red (#d5252f) is the single chromatic accent. Light canvas with semantic success (green), warn (amber), danger (red), and info (blue) for progress bars, badges, and status indicators. Inter + JetBrains Mono typography. Generous spacing for CRM contacts/tasks/activities clarity. Reference implementation: src/app/globals.css."

# The app ships one theme only (light). There is no dark mode and no
# theme switcher — see "Theming" below.

colors:
  accent: "#d5252f"
  accent-hover: "#b81f27"
  accent-focus: "#b81f27"
  accent-soft: "#fae5e6"
  ink: "#17151c"
  ink-soft: "#5b5865"
  ink-muted: "#8b8894"
  canvas: "#f5f4f7"
  surface-1: "#fbfafc"
  surface-2: "#ffffff"
  surface-tint: "#f3e9ea"
  surface-sunken: "#efeef2"
  border: "rgba(0,0,0,0.08)"
  border-strong: "rgba(0,0,0,0.16)"
  semantic-success: "#15803d"
  semantic-warn: "#b45309"
  semantic-danger: "#dc2626"
  semantic-info: "#1d4ed8"
  # Badge/status text — darker than the base semantic tokens above so text
  # sitting on a translucent tint still clears AA (see "Status, Info &
  # Badge-Text Tokens" below).
  success-text: "#166534"
  warn-text: "#92400e"
  danger-text: "#b91c1c"
  info-text: "#1e40af"

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

The app is a dense, light, data-first internal tool (a Business Developer contact base) — closer in spirit to Linear's own *product* surface than to Linear's marketing site, so structure was pulled from Linear's spec but scaled down: no 80px display type, no product-screenshot hero cards, no 96px section rhythm. Instead the scale is compressed to match a table-and-form-heavy internal app.

**The app ships one theme only: light.** There is no dark mode, no theme cookie, and no theme switcher — see **Theming** below.

**The app ships one UI language: Spanish.** There is no language switcher and no English UI path — see **Language** below.

**Key characteristics:**
- **Near-white canvas** (`--color-canvas` #f5f4f7) with a two-step surface lift (`--color-surface-1` → `--color-surface-2`), not Linear's four-step ladder — this app doesn't need that much depth.
- **Avalith red** (`--color-accent` #d5252f) is the single chromatic accent — brand mark, eyebrow labels, links, focus rings, primary buttons — mirroring how sparingly Linear uses its lavender.
- **Inter** carries every text role (headings, body, buttons); **JetBrains Mono** is reserved for the `// eyebrow` labels, badges, and a few mono status strings — same "mono only in taxonomy contexts" principle as Linear.
- Semantic colors (`success`, `warn`, `danger`, `info`) are kept **distinct from the brand accent**, exactly as Linear keeps its green separate from lavender.
- Cards/panels use 6–8px radii and 1px hairline borders — no shadow-driven elevation except the one dropdown menu.

## Brand facts used (source: `/Users/cristiancivita/avalith/contexto/`)

- `contexto/empresa.md` does not document any color, font, or logo facts — it's company/business context (services, clients, positioning), not a brand-asset file. **No conflicting or confirming brand facts were found there.**
- The actual brand source of truth is the code already in production: `src/app/globals.css` (`:root` tokens) and `src/app/layout.tsx` (font loading). Per this repo's own `CLAUDE.md`, anything not confirmed by Cristian or a cited source should be flagged `(?)` — so: **the red hex `#d5252f` and the Inter/JetBrains Mono pairing are taken as given because they are the live, shipped brand (not merely a claim in `contexto/`) `(?)` no separate brand-guideline doc was found to cite.**

## Color Palette & Roles

| Token | Hex / Value | Role |
|---|---|---|
| `--color-canvas` | `#f5f4f7` | Page background — near-white, not pure white |
| `--color-surface-1` | `#fbfafc` | Cards, import blocks, table hover rows' containers, dropdown menu |
| `--color-surface-2` | `#ffffff` | Panels (the main content container level) — the brightest surface |
| `--color-surface-tint` | `#f3e9ea` | Reserved — the "offshore" signal badge only, not general surface use |
| `--color-surface-sunken` | `#efeef2` | Reserved for the app-shell sidebar/top bar (Phase 8) |
| `--color-accent` | `#d5252f` | Brand mark, eyebrow, links, focus, primary buttons, active states — ~5.1:1 on white, clears AA |
| `--color-accent-hover` | `#b81f27` | Hover state of accent-colored buttons/links — **darkens**, not lightens (see note below) |
| `--color-accent-focus` | `#b81f27` | Active/pressed state and the focus-visible ring color |
| `--color-accent-soft` | `#fae5e6` | Reserved for active sidebar item / selected-row tint (Phase 8) |
| `--color-ink` | `#17151c` | Primary text, headings |
| `--color-ink-soft` | `#5b5865` | Secondary text, labels, nav links — **~6.9:1 contrast on white** (AA requires 4.5:1) |
| `--color-ink-muted` | `#8b8894` | Tertiary/disabled text (no AA requirement — see Do/Don't) |
| `--color-border` | `rgba(0,0,0,.08)` | Default hairline borders |
| `--color-border-strong` | `rgba(0,0,0,.16)` | Emphasized borders — secondary buttons, dropdown, active tabs |
| `--color-success` | `#15803d` | "Hiring" / positive badges — ~5.0:1 on white |
| `--color-warn` | `#b45309` | Non-blocking warnings (e.g. upload sender-detection notices) — ~5.0:1 on white |
| `--color-danger` | `#dc2626` | Form/import errors — intentionally distinct from the brand accent red — ~4.8:1 on white |
| `--color-info` | `#1d4ed8` | "Contacted" lead/lifecycle status (new token, added with the status badges below) |

**Accent hover fix (owner-approved, 2026-09-24):** the previous hover value `#e6434c` (a *lighter* red) was only 3.98:1 against white button text, failing AA. `--color-accent-hover` now equals `--color-accent-focus` (`#b81f27`, 6.44:1) — hover **darkens** the accent instead of lightening it. `#e6434c` no longer appears as an active token anywhere in `globals.css`.

## Status, Info & Badge-Text Tokens

Two token families were added to `globals.css` beyond the original Linear-derived set:

**Badge/status text** — a darker shade than the base semantic token, because badge text sits on top of a translucent tint background rather than directly on canvas, and needs the extra contrast to clear AA (owner-approved, 2026-09-24):

| Token | Hex | Contrast on its own badge background |
|---|---|---|
| `--color-success-text` | `#166534` | 6.08:1 on `--color-badge-success-bg` (vs. 5.02:1 for the base `--color-success` on white) |
| `--color-warn-text` | `#92400e` | Same pattern as success |
| `--color-danger-text` | `#b91c1c` | Same pattern as success |
| `--color-info-text` | `#1e40af` | Same pattern as success |

**Translucent fills** (badges, row hover) — same rgba across the app, no per-component literal:

| Token | Value |
|---|---|
| `--color-badge-accent-bg` | `rgba(213,37,47,.12)` |
| `--color-badge-success-bg` | `rgba(21,128,61,.12)` |
| `--color-badge-warn-bg` | `rgba(180,83,9,.12)` |
| `--color-badge-danger-bg` | `rgba(220,38,38,.12)` |
| `--color-badge-info-bg` | `rgba(29,78,216,.12)` |
| `--color-row-hover` | `rgba(0,0,0,.03)` |

**Contact lifecycle status badges** (proposed in `mockups/styles.css`, now shipped in `globals.css` for the leads/companies detail pages' stage badges):

| Status | Text | Background |
|---|---|---|
| New | `--status-new-text` `#4a4753` | `--status-new-bg` `#f1f1f2` |
| Contacted | `--status-contacted-text` `#1e40af` | `--status-contacted-bg` `#e4eafa` |
| Replied | `--status-replied-text` `#5b21b6` | `--status-replied-bg` `#ede5fa` |
| Meeting | `--status-meeting-text` `#166534` | `--status-meeting-bg` `#e3f0e8` |
| Discarded | `--status-discarded-text` `#4a4753` | `--status-discarded-bg` `#e6e5e9` |

## Theming

The app is **light-only**. There is no dark theme, no theme cookie, no `ThemeSwitcher`, and no `[data-theme]`/`prefers-color-scheme` branching in `globals.css` — `:root` holds a single set of values (`color-scheme: light;` is set explicitly so native controls/scrollbars never darken). The light values shown in **Color Palette & Roles** above are the only values that exist; there is no separate "dark" or "default" palette anywhere in the codebase.

## Language

The app is **Spanish-only** (owner decision D10, `design.md`). There is no `LocaleSwitcher` and no cookie-driven locale selection. `src/lib/i18n/server.ts#getLocale()` always returns `DEFAULT_LOCALE` (`"es"`); all user-facing copy resolves through the single `es` dictionary. The `{ en, es }` dictionary structure (`src/lib/i18n/dictionaries/`) and the `Locale`/`LOCALES` types are kept intact so English can be re-added cheaply later, and because `isLocale` still validates the *outreach message* generation language (English/Spanish is a per-message business choice, unrelated to UI chrome locale) — but nothing in the UI imports or renders the `en` dictionary. Glossary terms in `mockups/GLOSSARY.md` are the source of truth for Spanish copy and must be used consistently across screens.

Two more tokens exist purely for the select chevron icon: `--icon-select-chevron` is a data-URI SVG with its stroke color baked in (it can't use `currentColor`), so the whole `background-image` is a token rather than an inline literal.

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
- **Link-as-button** (`.secondary-btn`): same visual spec as `button.secondary` but for `<Link>` nav items (e.g. header nav, "back"). Has a `.disabled` and an `.active` modifier (used by the What's New window-selector toggles).

### Inputs & Selects
- `input[type=text|password|file]` and `select` (select styling added in this pass — it was previously unstyled and fell back to the browser default) share one spec: `--color-canvas` background, 1px `--color-border`, `border-radius: 6px`, `--color-ink` text. Hover → border brightens to `--color-border-strong`. Focus → border to `--color-accent`. Disabled → `opacity: .55`.
- Every control in a filter row — text input, select, submit button, checkbox row — is exactly `--control-height` (2.5rem) tall, so toolbars align on one line. Selects use `appearance: none` with a custom chevron; never rely on native select metrics. File inputs are the only exception (natural height).
- Checkboxes in a filter toolbar never take a slot of their own: they stack in one `.filter-checkbox-group` column at the end of the row, next to the submit button. Keep their labels short (2–4 words).
- Checkboxes use `accent-color: var(--color-accent)` (native control tinting, no custom widget).

### Tables
- Borderless rows separated by 1px `--color-border` bottom rules; header row in `--color-ink-soft`, `text-sm` size, uppercase-style tracking. Row hover tints the cell background via `--color-row-hover` (`rgba(0,0,0,.03)`).

### Badges
- Base `.badge`: pill, mono, 700 weight, `--color-badge-accent-bg` background, `--color-accent` text.
- `.badge.green` / `.badge.hiring` / `.badge.startup`: `--color-badge-success-bg` background, `--color-success-text` text (the darker badge-text token, not the base `--color-success`).
- `.badge.warn`: `--color-badge-warn-bg` background, `--color-warn-text` text — used for the "medium" email-suggestion confidence chip.
- `.badge.offshore`: the one deliberate exception — uses `--color-surface-tint` + `--color-ink-soft`, never red or green, because it's a neutral factual signal, not a positive or negative one (see the code comment on `.badge.offshore` in `globals.css`).
- No CSS classes exist yet for the contact-lifecycle status tokens (`--status-new-*`, `--status-contacted-*`, etc. — see **Status, Info & Badge-Text Tokens**); they are defined in `globals.css` for upcoming record/list pages to consume.

### Panels / Cards
- `.panel`: the primary content container — `--color-surface-2`, 1px border, 8px radius.
- `.import-block`, `.filter-helper`, `.whats-new-company`, `.thread`: secondary containers at `--color-surface-1`, same border/radius language, used for collapsible or nested content.

### Navigation
- `.header`: flex row, logo left, actions right (`.back-btn` first, then nav links as `.secondary-btn`, then `.user-menu`) — used on pages that predate the Phase 8 app shell.
- `.back-btn`: icon-only "go back" control (`BackButton.tsx`) — same height/radius/border language as `.secondary-btn` and `.user-menu-trigger`, navigates browser history via `router.back()` with a `fallbackHref` for dead-end history.
- `.user-menu` (`UserMenu.tsx`, `src/app/UserMenu.tsx`): icon trigger (`.user-menu-trigger`) opening a `.user-menu-dropdown` — `--color-surface-1`, `--color-border-strong` border, drop shadow (`--shadow-dropdown`), containing the account name, "change password" link, and sign-out. No locale or theme controls — both were removed with the language and theme switchers.

### Dropdown Menu
- `.user-menu-dropdown` is the one component with a drop shadow (`--shadow-dropdown`, `0 8px 24px rgba(23,21,28,.12)`) — otherwise the system relies on surface contrast, not shadows, for elevation.

### Chips
- `.chip`: pill, `--color-surface-1`, 1px `--color-border`, used for active-filter chips (each with an inline `×` remove link) and, via `.reason-chips`, for outreach ranking-reason badges.

## App Shell

Phase 8 (design.md D9) introduced a persistent app shell wrapping every authenticated page:

- **`Sidebar`** (`src/app/contacts/Sidebar.tsx` + `Sidebar.module.css`): collapsible left nav, `--sidebar-width` (232px) wide, grouped into a "workspace" section (Leads → `/contacts`, Companies, Tasks, Outreach) and a "signals" section (Hiring, What's New, Discovery), plus an account link in the footer. Labels come from the `es` dictionary via `NavLabels`/`pickNavLabels`, not hardcoded strings.
- **`TopBar`** (`src/app/contacts/TopBar.tsx` + `TopBar.module.css`): breadcrumb (derived from the active `Sidebar` nav item) plus a contacts-only search field that submits to `/contacts?q=...`. Height is `--topbar-height` (52px).
- Both components live under `src/app/contacts/` (not `src/components/`) per design.md D9 — they are extracted to a shared location only once a second surface (e.g. Companies) adopts them independently.
- **Wiring:** `src/app/(app)/layout.tsx` renders `<Sidebar>` + a `.main-layout` wrapper containing `<TopBar>` and `{children}` — this is the shell every route under the `(app)` route group gets automatically.
- **Auth screens have no shell:** `src/app/(auth)/layout.tsx` is a bare pass-through (`children` only) so `/login` and `/account/password` render their own centered `.form-narrow` card with no `Sidebar`/`TopBar` chrome, matching `mockups/login.html`.
- `.main-layout` collapses its `margin-left` to 0 below the `768px` breakpoint (see **Responsive**).

## Layout / Spacing

- **Base unit:** loosely 4px, expressed as a rem-based scale: `2xs 0.35rem · xs 0.4rem · sm 0.5rem · md 0.75rem · lg 1rem · xl 1.25rem · 2xl 1.5rem · 3xl 1.75rem`.
- **Page container:** `main` fills the space to the right of the sidebar (`max-width: none`), `1.5rem 1.75rem` (`--space-2xl --space-3xl`) padding. Auth/detail pages narrow content locally (`.form-narrow` 400px, `.detail-narrow` 720px).
- **Section rhythm:** panels/cards stack with `2xl` (1.5rem) bottom margin; the page header sits `3xl` (1.75rem) above content.
- **Control heights:** `--control-height` (2.5rem) for filter-row inputs/selects/buttons; `--control-height-sm` (1.85rem) for the `TopBar` search field.
- **Utility classes** (in `globals.css`): `.m-0/.mt-0/.mb-0`, `.mt-2xs/.mt-md/.mt-lg/.mt-xl/.mt-3xl`, `.mb-md/.mb-lg/.mb-2xl/.mb-3xl`, `.ml-sm`, `.row-md/.row-xs` (gap modifiers on `.row`), `.field-grow`, `.form-narrow/.detail-narrow`, `.inline-block`, `.text-danger/.text-warn`. These replace one-off inline `style={{...}}` spacing that used to live in `src/app/**/*.tsx`.

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
- Keep semantic colors (`success`/`warn`/`danger`/`info`) separate from the brand accent, even though both the accent and `danger` are red-family — they must never be swapped for each other.
- Use the badge-text tokens (`--color-success-text`, etc.), not the base semantic token, for text on a translucent badge background — the base token alone doesn't clear AA there.
- Keep mono (JetBrains Mono) scoped to eyebrows, badges, and status strings.
- Add real hover/active/disabled/focus-visible states to any new interactive element — don't ship a control with only a default state.

### Don't
- Don't introduce a second chromatic accent color for anything decorative.
- Don't use `--color-surface-tint` (the offshore-badge warm tone) as a general surface — it is a single-purpose neutral signal color.
- Don't add drop shadows outside the dropdown menu.
- Don't hardcode hex colors, spacing, or radii in component CSS — consume the tokens in `:root`.
- Don't reach for inline `style={{...}}` for spacing/layout that a utility class already covers.
- Don't reintroduce a theme cookie, `ThemeSwitcher`, `LocaleSwitcher`, or `[data-theme]`/`prefers-color-scheme` branching — the app is light-only and Spanish-only by owner decision (see **Theming** and **Language**).
- **Never hardcode a color outside the token layer.** Every hex/rgba value belongs in `:root` in `src/app/globals.css` — never inline in a component rule, never in a TSX `style={{}}`, never baked into an SVG's `stroke`/`fill` (use `currentColor`, or — if the icon is a data-URI that can't use `currentColor` — put the whole `background-image`/`mask-image` behind a token, as `--icon-select-chevron` does).

## Responsive

- **`768px`:** `.main-layout` collapses `margin-left` (the sidebar offset) to 0, and `main`'s top padding grows by `60px` to clear the `Sidebar`'s mobile toggle button (`Sidebar.tsx`'s `☰` trigger, `Sidebar.module.css`'s `.toggleButton`).
- **`560px` (mobile):** filter toolbars, checkbox rows, and the what's-new toolbar switch from row to stacked `flex-direction: column`; `.example-list`'s CSS columns collapse to 1.
- Table wrappers (`.table-wrap`) scroll horizontally rather than reflow columns.

## Agent Prompt Guide

When extending this UI:
1. Reach for an existing class first (`.panel`, `.badge`, `.chip`, `.secondary-btn`, `.filter-*`) before writing new CSS.
2. If a new value is needed, add it as a token in `:root` (color/spacing/radius) rather than a hardcoded value in a rule.
3. Any new interactive element needs `:hover`, `:disabled` (if applicable), and relies on the global `:focus-visible` rule — don't override focus-visible per component unless the default 2px accent-focus ring is genuinely wrong for that control.
4. Spacing in JSX belongs in a utility class (see the "Layout / Spacing" utility list above), not `style={{}}` — add a new utility to `globals.css` if the scale doesn't already cover the value you need.
5. Never introduce a second chromatic accent, a drop shadow, or a font outside Inter/JetBrains Mono.
6. Keep `.badge.offshore` semantics intact: it is neither positive (green) nor negative (red) — a new "neutral factual signal" badge should follow its pattern, not invent a third color.
