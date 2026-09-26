# Tasks — mockup-parity

Source of truth: `openspec/changes/crm-hubspot-ux/mockups/` (styles.css,
design-system.html, per-screen HTMLs, GLOSSARY.md for copy) and `DESIGN.md`
(tokens). Mockups are owner-approved; where a mockup token value differs from
`DESIGN.md` (avatar palette, accent hover contrast), the mockup wins and
`DESIGN.md` is updated to match — see `design-system.html`'s own "Cambio
respecto de DESIGN.md" alert, which documents that the darker hover
(`#b81f27`, 6.44:1) and darker avatar colors (`#7a6653`, `#8a5a2b`,
`#3f6f5f`, `#4b6380`) are the approved AA fix, not a proposal pending review.

Audit performed against production (`origin/main`, no uncommitted local
state) on 2026-09-26.

## Phase 1 — Shell fixes (branch `feat/mockup-parity-01-shell-fixes`)

- [x] 1.1 Remove the duplicate `<div className="header"><span className="logo">...` block from `/hiring`, `/discovery`, `/whats-new` — the app shell (`(app)/layout.tsx` → `Sidebar`) already renders the logo; these pages currently render it a second time inside `<main>` (visible bug in prod). Keep the `row row-md` nav/account content as a direct child of `<main>` — those controls (BackButton, cross-links, UserMenu) aren't migrated onto the shell TopBar yet (out of scope here; see Phase 6).
  - Note: `/outreach` has the identical bug but is intentionally excluded — it's mid-flight to a redirect-only page in another PR (`feat/crm-hubspot-ux-15b-outreach-redirect`, not yet merged to `origin/main`); touching it here would conflict.
- [x] 1.2 Add missing design tokens to `src/app/globals.css` per `mockups/styles.css` and `DESIGN.md`:
  - `--color-ink-subtle: #6e6b78` (meta text/placeholders, 5.2:1)
  - `--color-accent-strong` and `--color-accent-press` — aliased to existing values rather than inventing unreviewed hex: `--color-accent-strong: var(--color-accent-focus)` (mockup's approved darker hover, `#b81f27`, already equals our existing `--color-accent-focus`), `--color-accent-press: #9c1a21` (mockup's approved pressed state — part of the owner-approved mockup, not a new proposal)
  - `--color-overlay: rgba(23, 21, 28, 0.42)`
  - `--color-on-dark`, `--color-on-dark-hover`, `--color-on-dark-sep`, `--color-on-dark-success`, `--color-on-dark-link`
  - `--shadow-dialog: 0 24px 48px rgba(23, 21, 28, 0.2)`
  - `--focus-ring: 0 0 0 2px var(--color-surface-2), 0 0 0 4px var(--color-accent-strong)`
  - `--radius-lg: 12px`
  - `--record-left: 320px`, `--record-right: 300px`
  - `--avatar-1` through `--avatar-6` (mockup's darkened AA-safe values: `#6b5b95, #7a6653, #88398a, #8a5a2b, #3f6f5f, #4b6380`)
- [x] 1.3 Update `DESIGN.md`'s token table and avatar palette to match the values added in 1.2 (avatar-2/4/5/6 were stale pastel values that fail AA for white initials text; document the accent-strong/press aliasing decision).

## Phase 2 — Shared primitives (branch `feat/mockup-parity-02-components`, chained on phase 1)

- [x] 2.1 `Avatar` component (`src/components/Avatar.tsx` + pure palette-selection function, unit-tested RED→GREEN): deterministic `avatar-1..6` class from a stable id (e.g. contact/BD id), renders initials, supports circle (contact) vs rounded-square (`avatar-bd`) per `design-system.html`. DONE — `src/components/avatarPalette.ts` (pure fn, RED→GREEN in `tests/unit/avatarPalette.test.ts`) + `src/components/Avatar.tsx`.
- [x] 2.2 Shared `Dialog` component (`src/components/Dialog.tsx`): overlay + `aria-modal`, focus trap, Esc to close, returns focus to the trigger on close, matches `.overlay`/`.dialog` classes and structure from `design-system.html`/`styles.css`. DONE.
- [x] 2.3 Shared `Toast` component (`src/components/Toast.tsx` + a toast region/provider): on-dark tokens, `role="status"`, `aria-live="polite"`, matches `.toast`/`.toast-region` classes. DONE — `src/components/Toast.tsx` (presentational) + `src/components/ToastProvider.tsx` (`useToast()` hook, auto-dismiss with pause on hover/focus) + `src/components/toastTimer.ts` (pure timer state, RED→GREEN in `tests/unit/toastTimer.test.ts`).
- [x] 2.4 Wire `Toast` region into the app shell (`(app)/layout.tsx`) so any page can trigger a toast without its own ad hoc implementation. DONE — `ToastProvider` now wraps `(app)/layout.tsx`.

## Phase 3 — TopBar + Sidebar parity (branches chained on phase 2, split into 3a/3b: actual size came in over the ~250-350 line forecast, mostly the new shared `DropdownMenu` + icon library)

- [x] 3.1 TopBar "Crear" menu (branch `feat/mockup-parity-03-shell-nav`). DONE — new generic `DropdownMenu` component (`src/components/DropdownMenu.tsx`), used instead of the mockup's `<details>` per the apply instructions' keyboard-accessibility requirement. Only "Importar contactos" → `/contacts/import` is wired; the mockup's Contacto/Tarea/Nota en un contacto items are omitted because no standalone new-contact form, global new-task modal, or contact-note picker exists yet (see TopBar.tsx's comment).
- [x] 3.2 TopBar account/avatar menu (same branch). DONE — replaces the ad hoc `UserMenu` on `/hiring`, `/discovery`, `/whats-new` (shell now covers it); `/outreach` keeps `UserMenu` (mid-flight on another branch, out of scope). New pure `initialsFromName` helper (RED→GREEN in `tests/unit/initials.test.ts`) derives the avatar initials from the BD's name.
- [x] 3.3 Sidebar nav icons (branch `feat/mockup-parity-03b-sidebar-icons`, chained on 3a). DONE — per-item icons added, deferred from Phase 8. Item **counts** (`.nav-count`/`.pill-count`) are intentionally NOT added: no cheap count-only query exists yet for contacts/tasks/discovery (existing queries return full rows, not a count), and the apply instructions require counts to come from a cheap existing query or be left out — revisit once such a query exists.

## Phase 4 — Contacts list + record quick actions (branches `feat/mockup-parity-04a-list-avatars`, `04b-quickactions-dialog`, `04c-board-move-confirm`, chained on phase 3)

- [x] 4.1 Contacts list avatars + owner chips (`Avatar` component from 2.1). DONE — `page.tsx` name cell (circle avatar) and owner column, `Board.tsx` card foot (rounded-square `avatar-bd` owner-chip). No query changes: `ContactListRow` already carried `ownerBdId`/`ownerName`.
- [x] 4.2 Record quick actions (discard, log meeting, etc.) migrated to `Dialog` (2.2) instead of ad hoc modals. DONE — Task/Email/Meeting/Discard composers now render inside `Dialog`, matching mockups/contact-record.html's `#task`/`#email`/`#meeting`/`#discard` overlays; Note and "Pegar señal" stay inline (mockup's own `#log-note` composer isn't a dialog either). Every quick action also shows a success/failure Toast (2.3/2.4).
- [x] 4.3 Board move-confirm dialog using `Dialog`. DONE — both the drag-and-drop drop and the native "Mover a..." menu now confirm through a shared `Dialog` before navigating to `/contacts/[id]?openAction=X`; no-JS fallback (the plain link) is unchanged.

## Phase 5 — Account pages

- [x] 5.1 Redesign `/account`, `/account/password` pages per mockups (`account.html`, `account-password.html`, `account-email.html`). DONE — split into two branches (over the ~200-300 line forecast once the two full pages + shared icons/dict were counted together): `feat/mockup-parity-05-account` (account settings hub — profile card, preferences, connections/security list, sign-out) and `feat/mockup-parity-05b-account-email` (Gmail connection screen — status cards, props list, alerts, one-time success Toast). `/account/password` is intentionally left as-is: it's the `(auth)` route group's bare, no-shell layout (tasks.md 8.2 decision, shared with `/login`), reused for both first-time password setup and later changes — restyling it alone to the mockup's `.card`/`.field` language would fork it visually from `/login`, which is out of this phase's scope.
- [x] 5.2 Spanish copy pass via `GLOSSARY.md`. DONE — new `accountSettings`/`accountEmail` dictionary namespaces (en+es); `/account/password` was already fully Spanish from an earlier phase.

  Deviations from the mockups: no interactive Preferencias/Idioma toggle (product decision D10, `locales.ts` — Spanish-only, no `LocaleSwitcher`); no "Cambiada hace N meses" password meta (not tracked, replaced with a generic reminder); no "Desconectar" Gmail button (no disconnect server action/route exists yet — adding one would be a new feature, not a restyle; the connected card keeps the existing "Reconectar Gmail" action in that footer slot instead).

## Phase 6 — Legacy page restyle

- [x] 6.1 `/hiring`, `/discovery`, `/whats-new` full restyle (beyond the Phase 1 header fix): migrate remaining ad hoc modals/dropdowns to `Dialog`/`Toast`, adopt shared `Avatar` where applicable.
  - DONE (branch `feat/mockup-parity-06e-signals-pages`, chained on `06d-companies-new`): all three pages already used the app's shared `.panel`/`.eyebrow`/`.filter-toolbar`/`.table-wrap`/`.badge` global classes and were already fully Spanish (via the legacy `t(locale)` dictionary) — the Phase 1 fix only removed the *duplicate logo/header*, not the page-local nav row underneath it. This batch removed that redundant `row row-md` block (`BackButton` + `Outreach`/`Vacantes`/`Novedades`/`Contactos` `secondary-btn` cross-links) from all three pages: the shell `Sidebar` already lists the same routes and `TopBar`'s breadcrumb already shows the current page, so the block was pure duplication (each file's own comment already flagged it as "hasn't migrated onto the shell TopBar yet, see Phase 6"). No server action, query, or filter logic touched.
    - Deviation: no ad hoc modals or dropdowns exist on any of these three pages to migrate — `/discovery`'s approve/reject are plain `<form action={...}>` server-action buttons (no modal), and the `<details class="filter-helper">` postings disclosures on `/hiring` and `/whats-new` are native accordions, not modals. Nothing to move to `Dialog`.
    - Deviation: no owner/contact avatars are rendered on any of these three pages (they show company/job-posting data, not person records), so there was nothing to adopt shared `Avatar` for.
    - Deviation: `mockups/hiring.html` redesigns the whole page around a company-per-market-count table (LATAM/US/Miami columns, company-logo avatars) — its own `mock-note` flags it as "Solo rediseño" but the counts it shows (per-market posting breakdown) aren't in `CompanyHiringSummary` today (only `latamItCount`/`offshoreItCount` are, no US/Miami split), and computing them from the raw `postings` array here would be new derived-data logic, not a presentation tweak. Deferred; the existing `<details>`-based postings list stays.
- [x] 6.2 `/tasks`, `/companies`, company record restyle + modal migration.
  - DONE (branch `feat/mockup-parity-06a-tasks`, chained on `05c-toast-param`): `/tasks` rebuilt per `mockups/tasks.html` — three-tier grouping (Vencidas/Hoy/Próximas) inside a shared table pattern (`.tableWrap`/`.table`, page-scoped module classes, not the mockup's literal global class names — same convention as Phase 5), `owner-chip` + `Avatar` (`variant="bd"`) for the responsable column, danger/warn/neutral due-date badges. `CompleteTaskButton` changed from a round ✓ button to a checkbox input (matches the mockup's `col-check` pattern) with the exact same `completeTaskAction` call/loading/error handling — no server action or query changed. New `tasksPage` dict namespace (en+es) replaces the page's hardcoded English strings and emoji.
    - Deviation: the mockup's `view-tabs` (Mis tareas abiertas / Todas abiertas / Completadas) and "Nueva tarea" primary action were NOT implemented — both would require new queries/routes ("all tasks across BDs", "completed tasks", a task-creation form) that don't exist in the current codebase, which is out of scope for a presentation-only restyle ("keep every server action, query and filter behavior unchanged").
    - Deviation: the mockup's "Asociado con" column links to `contact-record.html`; the current `getOpenTasks`/`getOverdueTasks` queries return `leadId`/`companyKey` as presence flags only (no contact/company name or a verified route), so the column renders a plain "Contacto"/"Empresa" label instead of a link, to avoid fabricating a navigation target.
  - DONE (branch `feat/mockup-parity-06b-companies-list`, chained on `06a-tasks`): `/companies` list rebuilt per `mockups/companies.html` — page-header with a "Nueva empresa" button linking to the existing `/companies/new` route, a GET `<form>` toolbar (search input + stage `<select>` + submit button, all wired to the *same* `search`/`stage` query params `getCompanies` already reads — this also incidentally fixes a pre-existing bug where the old inputs had no `<form>`/`onChange` at all and could never actually submit a filter), and a `.tableWrap`/`.table` row-per-company layout with a company-logo `Avatar` (`variant="bd"`, initials via `initialsFromName`), stage badge, notes, and revenue-potential columns. New `companiesPage` dict namespace (en+es) with stage labels replaces hardcoded English strings.
    - Deviation: the mockup's `view-tabs` (Todas las empresas / Mis empresas / Contratando ahora) were not implemented — "Mis empresas" and "Contratando ahora" need an owner column and a hiring-status join that `getCompanies`/the `company` table don't currently have.
    - Deviation: the mockup's table has Industria/Responsable/Contactos/Vacantes/Última actividad columns; `getCompanies`/`CompanyRow` only expose `displayName`, `relationshipStage`, `revenuePotential`, `notes` — those five columns were replaced with Empresa/Etapa/Notas/Potencial de ingresos (the fields that actually exist), rather than joining new queries for a presentation-only pass.
    - Deviation: pagination kept as numbered page links (restyled) instead of the mockup's Anterior/Siguiente-only footer, to avoid reducing existing jump-to-page navigability.
  - DONE (branch `feat/mockup-parity-06c-company-record`, chained on `06b-companies-list`): `/companies/[key]` restyled and `EditCompanyButton`/`AddActivityButton` migrated off their own hand-rolled `.modal`/`.overlay` markup onto the shared `Dialog` + `useToast` (success/error toasts on save, matching the `QuickActions` convention from Phase 4). Company identity row now uses a company-logo `Avatar` (`variant="bd", size="lg"`). New `companyRecord` dict namespace (en+es), reusing `companiesPage`'s stage labels rather than duplicating them. `EditCompanyModal.module.css`/`AddActivityModal.module.css` slimmed down to just the form-field styles (Dialog itself owns `.overlay`/`.dialog` chrome globally now).
    - Deviation: `mockups/company-record.html`'s full three-panel RecordShell (About/Timeline/Associations, owner chip, hiring signals, contact associations, startup classification) was explicitly NOT built — the mockup's own `mock-note` flags that redesign as "Solo rediseño (cambio posterior)", i.e. deferred to a later change, and `getCompanyByKey`/`getActivitiesByCompany` don't join any of that data (owner, location, associations, hiring counts) today. This restyle keeps the existing single-column structure (identity + stage badge, revenue, notes, activity timeline, actions) reskinned with shared tokens and Spanish copy, not a structural rebuild.
  - DONE (branch `feat/mockup-parity-06d-companies-new`, chained on `06c-company-record`): `/companies/new` restyled — no dedicated mockup exists for this screen (mockups/companies.html only links to it), so it got the shared page chrome (eyebrow/title header + a `.form` card with labeled fields), per the "no mockup → shared page chrome" instruction. New `companyForm` dict namespace (en+es); server action (`createCompanyAction`) and validation/redirect logic unchanged.
  - Split rationale: 6.2's full diff (tasks + companies list + company record + companies/new) was split into four branches (`06a`–`06d`) to stay near the ~400-changed-line-per-branch budget — `06c` alone was 292 insertions/282 deletions before the split point.
  - REMAINING (not started this batch): `/hiring`, `/discovery`, `/whats-new` (6.1) — targeted for `06e`+.

## Phase 7 — Duplicates / import / migration polish

- [x] 7.1 `/duplicates`, `/import`, migration dry-run screens — visual parity + `Dialog`/`Toast` adoption.
  - DONE (branch `feat/mockup-parity-07a-admin-polish`, chained on `06f-review-fixes`): unified the `.page-header`/`.titles`/`.actions` chrome (eyebrow, lowercase `<h1>` + `.dot`, subtitle, actions slot) across `/admin/duplicates`, `/admin/migration` and `/contacts/import`, matching `mockups/duplicates.html`, `mockups/migration-dry-run.html` and `mockups/import.html`'s shared header pattern. `/admin/duplicates`'s compare table now shows an `Avatar` (existing `initialsFromName`, `detail.personA/B.id`) next to each "Ficha A/B" name, matching the mockup's per-side avatar. New `contactsImport.eyebrow` dict key (en+es). No server action or query touched.
  - Deviation: `/admin/duplicates`'s unmerge confirmation stays the existing server-rendered `?confirmUnmerge=` panel (not the shared client `Dialog`) — that was an intentional prior decision (see the page's own comment, "ported server-rendered/no-JS") so history rows work without JS; converting it to `Dialog` would be a behavior change, not a presentation-only polish pass.
  - Deviation: `/admin/duplicates`'s "Cola"/"Historial" mockup tabs stay a single scrolling page (existing behavior) rather than JS tabs — no new client-side state was introduced for a polish-only batch.
  - `/admin/migration` scope: per apply instructions (parallel `hubspot-import` branch adds a HubSpot section to this page), only the shared page-header chrome was touched; `MigrationKindSection`'s report tables/sections and every server action/query are unchanged.
  - Final polish: removed dead legacy CSS from `globals.css` — the pre-shell locale/theme switcher (`.locale-switcher`, `.locale-btn`, `.theme-switcher`, `.theme-btn`, `.user-menu-locale`, `.user-menu-theme`, `.user-menu-section-label`, all superseded by design D10's Spanish-only/no-switcher decision) and the pre-record-page "detail fields"/"conversation history" block (`.field`/`.field-label`/`.field-value`/`.suggestion-value`/`.suggestion-note`/`.thread*`/`.message*`, superseded by the new `/contacts/[id]` record page), plus unused `.mb-2xl`, `.detail-narrow` and `.avatar-stack` utilities — each verified unused across `src/**/*.{ts,tsx}` with `rg` before deletion. No remaining hardcoded English UI copy found in the shell (`Sidebar.tsx`/`TopBar.tsx` — only English code comments, which are in scope).
  - `npx tsc --noEmit` silent and `npm run test:unit` 405/405 pass. Diff: 47 insertions / 197 deletions (well under the ~200–300 line forecast — no chaining needed).

## Review Workload Forecast

| Phase | Est. changed lines | Chained PR? | Notes |
|---|---|---|---|
| 1 | ~120–180 | No (single PR) | 3 JSX unwraps + CSS token additions + DESIGN.md doc update |
| 2 | ~350–420 | Borderline — kept to Avatar+Dialog only in this batch, Toast deferred to keep phase 2 batch ≤400 | New components + unit tests + CSS additions already covered by phase 1 |
| 3 | ~250–350 | No | TopBar/Sidebar markup + CSS, no new primitives |
| 4 | ~300–400 | Maybe | Depends on how many quick-action modals exist |
| 5 | ~200–300 | No | Two pages, mostly markup/CSS + copy |
| 6 | ~400–600 | Yes | 5 legacy pages, likely 2 PRs |
| 7 | ~200–300 | No | 3 screens, smaller surface |

`400-line budget risk: Medium` (phase-dependent, phases 6 and possibly 4 are the risk points)
`Chained PRs recommended: Yes` (already reflected in the phase/branch split above)
`Decision needed before apply: No` (phase 1–2 boundary already fits `feature-branch-chain`; later phases will re-forecast per branch)

Chain strategy: `feature-branch-chain` (per delivery instructions) — phase branches target the previous phase's branch; a tracker PR (not created in this batch) aggregates to `main`.
