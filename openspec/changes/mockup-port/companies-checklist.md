# /companies (list) — checklist vs `openspec/changes/crm-hubspot-ux/mockups/companies.html`

Mockup note (companies.html line 63): same index pattern as `/contacts` (header, view tabs,
filter chips, table). The companies board/pipeline redesign is explicitly out of scope (later
change). Reference implementation for the pattern: `src/app/(app)/contacts/page.tsx`.

**Correction (owner, after c01):** the checklist below originally claimed
`src/lib/contacts/effectiveActivityTime.ts` and `openspec/changes/mockup-port/contacts-checklist.md`
don't exist. Both exist at the base commit (`33b834f`) — that was a base-commit mismatch from
reading outside this worktree while other agents were merging PRs into the main checkout
concurrently. Corrected in c02: `resolveEffectiveActivityAt`/`effectiveActivityAtSql` from
`effectiveActivityTime.ts` is what this page's Última actividad column uses.

Columns: `element | mockup ref | status | evidence file:line | notes`

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Page header (eyebrow, h1 "empresas.", subtitle) | companies.html:64 | done | `src/app/(app)/companies/page.tsx` (`page-header`/`titles`), `companyList` dict (en/es) | |
| "Nueva empresa" primary button | companies.html:64 | done | page.tsx (links to `/companies/new`) | |
| View tabs: "Todas las empresas" / "Mis empresas" / "Contratando ahora" (counts) | companies.html:65 | done, "Mis empresas" interim | `src/lib/companies/listQueries.ts` `getCompanyViewCounts`, page.tsx | "Mis empresas" filters on `created_by_bd_id` — an interim stand-in for a real owner (see pending-D1 below), documented in the query's own doc comment. "Contratando ahora" = `company_key IN (hiring index keys)`, correct since the index is already alias-resolved. |
| Filter chip: "Etapa: Cualquiera" (removable) | companies.html:66 | done | page.tsx (`chip`, `clearStageHref`) | |
| "Agregar filtro" chip → dropdown | companies.html:66 | done, single field | page.tsx (`details.dropdown` + stage `<select>`) | Mockup itself only ever shows one filterable dimension (Etapa) for companies — no parity gap with contacts' 10-option panel to close here. |
| "Columnas" button | companies.html:66 | **matches mockup as-is** | page.tsx (disabled, `title="Coming soon"/"Próximamente"`) | The approved mockup itself ships this as static chrome with no menu behind it (companies.html:66 has no menu markup) — not a deviation, a faithful port. Was previously flagged as D2; closed, no owner decision needed. |
| Table column: Empresa (logo chip + name, links to record) | companies.html:67 | done | page.tsx, reuses `companyLogoInitials` (`src/lib/contacts/companyLogo.ts`) | Domain-based favicon chip not built — `company.domain` exists on 2,703 companies but the mockup itself only shows a letter-initial chip, never a favicon; kept as initials to match the approved mockup exactly. |
| Table column: Industria | companies.html:67 | **pending D1** | `src/lib/companies/listMappers.ts` `industryLabel`, `listQueries.ts` (`industry: null` seam) | Owner-approved: `company.industry` is being added by the parallel data branch `feat/company-fields-01…`. The mapper already reads an optional `industry` field and shows "—"; once that branch merges, `listQueries.ts`'s row-building only needs to select the real column instead of hardcoding `null` — no page/mapper change. |
| Table column: Etapa (badge, tone by stage) | companies.html:67 | done | `listMappers.ts` `stageBadgeClass`, page.tsx | Ported onto `badge-info`/`badge-warn`/`badge-success`/`badge-outline`/`badge-neutral` (design tokens), not the old inline-hex `stageColor` map in `[key]/page.tsx`. |
| Table column: Responsable (owner) | companies.html:67-68 | **pending D1** | `listMappers.ts` `ownerLabel`, `listQueries.ts` (`ownerName: null` seam) | Same seam as Industria — `owner_bd_id` is on the same parallel data branch. Shows "—" until merged. |
| Table column: Contactos (count) | companies.html:67-68 | done | `listQueries.ts` (batched `person` count, current page's keys only) | Matches on `person.company_key` directly, not through `company_alias` — a person's `company_key` occasionally normalizes to an alias rather than the canonical key, which would undercount slightly. Flagged as a known limitation, not a deviation needing a decision (it's a real bug to fix, not a product call) — todo for a follow-up branch. |
| Table column: Vacantes (badge or "—") | companies.html:68 | done | `listMappers.ts` `vacantesLabel`, `getHiringMatchIndex()` | |
| Table column: Última actividad (relative time or "—") | companies.html:68 | done | `listQueries.ts` (`effectiveActivityAtSql`, batched MAX per page's keys) | Uses the real `effectiveActivityTime.ts` helper (corrected per owner note above), not a new one. |
| Table footer: "Mostrando N–M de TOTAL" | companies.html:76 | done | page.tsx (`l.showingRange`) | |
| Table footer: Anterior/Siguiente pager | companies.html:76 | done | page.tsx (`pageHref`), bounded (`PAGE_SIZE=50`, never a full 14,240-row scan) | |
| Empty state (no rows) | contacts pattern | done | page.tsx (`l.noResults`) | |
| Search box in topbar | companies.html:37 | n/a (shell chrome) | — | Global topbar, out of scope for this page. |

## Pending D1 (owner-approved 2026-09-26 — not blocked, just waiting on the data branch)

`company.industry`, `owner_bd_id`, `city`, `country` are being added by a parallel data-builder
branch (`feat/company-fields-01…`, forked from this same base commit `33b834f`) along with a
property-history table, an edit action, and the read-model fields in `getCompanyByKey`/the
companies list query, per the owner's message. This UI branch does **not** touch schema or
migrations (per instruction) — it only builds the seam:
- `src/lib/companies/listMappers.ts`: `industryLabel`/`ownerLabel`/`locationLabel` already read
  the optional fields and render "—" when absent (unit-tested).
- `src/lib/companies/listQueries.ts`: `CompanyListRow.industry`/`ownerName` are typed and
  currently hardcoded `null` with a comment pointing at the merge.
- Once `feat/company-fields-01…` merges into this chain, the only change needed here is
  selecting the real columns in `getCompanyListPage`'s row-building — no mapper, no page.tsx
  change.

## Known limitation (not a deviation, just not yet fixed)

- Contacts-per-company count matches `person.company_key` directly, not through
  `company_alias`. `getHiringMatchIndex`/`resolveHiringCompanies` already resolve aliases for
  the Vacantes badge; the contacts count doesn't yet. Todo for a follow-up branch — low
  priority, doesn't block the owner-decision items above.

## Batch history

- **c01** (`feat/mockup-port-c01-companies-checklist` @ `e4a17e3`): this checklist + the record
  checklist, docs only.
- **c02** (`feat/mockup-port-c02-companies-list` @ `580eb33`/`aa7b28e`): list page rebuilt for
  real — page header, view tabs, stage filter, full 7-column table, pager. New bounded queries
  (`listQueries.ts`), pure mappers with unit tests (`listMappers.ts`), `companyList` dictionary
  block (en/es). Industria/Responsable render through the pending-D1 seam.
