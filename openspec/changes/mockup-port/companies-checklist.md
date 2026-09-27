# /companies (list) — checklist vs `openspec/changes/crm-hubspot-ux/mockups/companies.html`

Mockup note (companies.html line 63): this change is shell-only for the list — same index
pattern as `/contacts` (header, view tabs, filter chips, table). The companies board/pipeline
redesign is explicitly out of scope (later change). Reference implementation for the pattern:
`src/app/(app)/contacts/page.tsx`.

Current state before this change: `src/app/(app)/companies/page.tsx` is the pre-reskin page —
plain search input + `<select>` stage filter + card list, no design tokens, no view tabs, no
table, no owner/industry/openings/last-activity columns. Every row below is `todo` unless noted.

Columns: `element | mockup ref | status | evidence file:line | notes`

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Page header (eyebrow "Empresas", h1 "empresas.", subtitle) | companies.html:64 | todo | — | Port `page-header`/`titles` pattern from contacts, own dictionary keys under `companyList`. |
| "Nueva empresa" primary button | companies.html:64 | todo | — | Links to `/companies/new`, already exists as a route. |
| View tabs: "Todas las empresas" (count), "Mis empresas" (count), "Contratando ahora" (count) | companies.html:65 | todo | — | "Mis empresas" needs an owner concept — see deviation D1. "Contratando ahora" = companies with >=1 open posting via `getHiringMatchIndex`. |
| Filter chip: "Etapa: Cualquiera" (removable) | companies.html:66 | todo | — | Maps to `relationshipStage` (`getCompanies` already filters by it). |
| "Agregar filtro" chip button | companies.html:66 | todo | — | Mockup only shows the affordance; contacts' filter panel (`details`/`columnPicker`) is the working pattern to reuse, not a dead button. |
| "Columnas" button | companies.html:66 | deviation | — | Mockup shows it disabled/decorative (no menu markup, unlike contacts' real column picker). D2: build a real column picker like contacts, or ship disabled with `title="Próximamente"` — owner decides. |
| Table column: Empresa (logo chip + name, links to record) | companies.html:67 | todo | — | Logo chip = first letter(s) of `displayName`; `href` uses `domain` when present for a favicon-style chip per the task brief, else initials. |
| Table column: Industria | companies.html:67 | deviation | — | **D1: `company` table has no `industry` column** (`src/db/schema.ts:971-999`). Options: (a) migrate a new column, (b) derive from the most common `person.industry` among linked contacts. Needs owner decision before building for real; ship "—" until decided. |
| Table column: Etapa (badge, tone by stage) | companies.html:67 | todo | — | `relationshipStage`; badge tone mapping already exists in `[key]/page.tsx:45-52`, needs porting to badge classes instead of inline styles. |
| Table column: Responsable (owner chip, avatar+name) | companies.html:67-68 | deviation | — | **D1 continued: `company` has no `owner_bd_id`.** Only `createdByBdId`/`updatedByBdId` (denormalized, not really "owner"). Needs an owner field (migration) or reuse `createdByBdId` as a stand-in — owner must decide. |
| Table column: Contactos (count, numeric) | companies.html:67-68 | todo | — | `count(*)` from `person` where `companyKey` (+ aliases) matches, bounded per-page (batch query, not N+1). |
| Table column: Vacantes (badge "N vacantes de IT" or "—") | companies.html:68 | todo | — | `getHiringMatchIndex()` per task brief; cached per request, matched by `companyKey` + aliases. |
| Table column: Última actividad (relative time or "—") | companies.html:68 | todo | — | From `activity` table scoped to the company (`getActivitiesByCompany` exists) using effective time — see note below on `deriveStatus.ts`. |
| Table footer: "Mostrando N–M de TOTAL" | companies.html:76 | todo | — | Same pattern as contacts' `showingRange`. |
| Table footer: Anterior/Siguiente pager | companies.html:76 | todo | — | Same pattern as contacts' `pageHref`/pager, bounded (14,240 companies → must paginate, never full-scan). |
| Empty state (no rows) | contacts pattern (companies.html has none, mirrors contacts' `l.noResults`) | todo | — | Reuse contacts' `styles.empty` pattern. |
| Search box in topbar ("Buscar contactos por...") | companies.html:37 | n/a (shell chrome) | — | Global topbar, not page-owned; out of scope for this page rebuild. |

## Deviations needing an owner decision

- **D1 — no `industry` / no `owner` column on `company`.** The mockup's Industria and
  Responsable columns need data the current schema doesn't have. Two real options: (1) add
  `industry` and `owner_bd_id` columns via a gated migration (`src/lib/migration/*` pattern,
  dry run → approval → execute), or (2) derive both from the linked `person` rows (most common
  `industry`, and treat `createdByBdId` as a stand-in owner). Recommend (1) for Responsable
  (an owner is a real assignment, not a guess) and (2) for Industria (already-known signal,
  no new write path needed) — but this is a product call, not an engineering one.
- **D2 — "Columnas" button.** Mockup shows it as static chrome (no menu). Build a real column
  picker (parity with contacts) or ship a disabled control with `title="Próximamente"` per
  ui-builder.md's rule that disabled/`Próximamente` controls are allowed only for structural
  chrome when the orchestrator says so.

## Notes

- The task brief pointed at `src/lib/contacts/effectiveActivityTime.ts` for the effective
  activity time helper; that file does not exist. The actual logic (using `metadata.originalAt`
  for `status_backfill` rows instead of `created_at`) lives in
  `src/lib/status/deriveStatus.ts:161-179`. Reuse that, not a new helper.
- No `openspec/changes/mockup-port/contacts-checklist.md` exists in the repo to use as a model
  (referenced by `.claude/agents/ui-builder.md:32` but never created) — this checklist follows
  the column format described there directly against `contacts/page.tsx` as the working
  reference implementation instead.
