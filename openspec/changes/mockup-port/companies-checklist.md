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
| View tabs: "Todas las empresas" / "Mis empresas" / "Contratando ahora" (counts) | companies.html:65 | done | `src/lib/companies/listQueries.ts` `getCompanyViewCounts`, page.tsx | "Mis empresas" now filters on the real `owner_bd_id` (c05) — was `created_by_bd_id` (interim stand-in) before D1 landed. "Contratando ahora" = `company_key IN (hiring index keys)`, correct since the index is already alias-resolved. |
| Filter chip: "Etapa: Cualquiera" (removable) | companies.html:66 | done | page.tsx (`chip`, `clearFilterHref`) | |
| "Agregar filtro" chip → dropdown | companies.html:66 | done, extended (c05) | page.tsx (`details.dropdown` + Etapa/Industria/Responsable) | Mockup itself only ever shows one filterable dimension (Etapa). Industria/Responsable added in c05 per explicit owner instruction, index-backed (`company_industry_idx`/`company_owner_idx`, migration 0017) — same "beyond-mockup filter" convention `/contacts` already established, documented in the code, not silent. |
| "Columnas" button | companies.html:66 | **matches mockup as-is** | page.tsx (disabled, `title="Coming soon"/"Próximamente"`) | The approved mockup itself ships this as static chrome with no menu behind it (companies.html:66 has no menu markup) — not a deviation, a faithful port. Was previously flagged as D2; closed, no owner decision needed. |
| Table column: Empresa (logo chip + name, links to record) | companies.html:67 | done | page.tsx, reuses `companyLogoInitials` (`src/lib/contacts/companyLogo.ts`) | Domain-based favicon chip not built — `company.domain` exists on 2,703 companies but the mockup itself only shows a letter-initial chip, never a favicon; kept as initials to match the approved mockup exactly. |
| Table column: Industria | companies.html:67 | **done (c05)** | `src/lib/companies/listMappers.ts` `industryLabel`, `listQueries.ts` (real `company.industry`, joined) | D1 landed (migration 0017, `feat/company-fields-03-require-headers`, backfilled 2,345 companies in prod). "—" now means "genuinely no industry on file", not "field doesn't exist yet". |
| Table column: Etapa (badge, tone by stage) | companies.html:67 | done | `listMappers.ts` `stageBadgeClass`, page.tsx | Ported onto `badge-info`/`badge-warn`/`badge-success`/`badge-outline`/`badge-neutral` (design tokens), not the old inline-hex `stageColor` map in `[key]/page.tsx`. |
| Table column: Responsable (owner) | companies.html:67-68 | **done (c05)** | `listMappers.ts` `ownerLabel`, `listQueries.ts` (`owner_bd_id` joined to `bd.name`) | D1 landed (backfilled 571 companies in prod). |
| Table column: Contactos (count) | companies.html:67-68 | done | `listQueries.ts` (batched `person` count, current page's keys only) | Matches on `person.company_key` directly, not through `company_alias` — a person's `company_key` occasionally normalizes to an alias rather than the canonical key, which would undercount slightly. Flagged as a known limitation, not a deviation needing a decision (it's a real bug to fix, not a product call) — todo for a follow-up branch. |
| Table column: Vacantes (badge or "—") | companies.html:68 | done | `listMappers.ts` `vacantesLabel`, `getHiringMatchIndex()` | |
| Table column: Última actividad (relative time or "—") | companies.html:68 | done | `listQueries.ts` (`effectiveActivityAtSql`, batched MAX per page's keys) | Uses the real `effectiveActivityTime.ts` helper (corrected per owner note above), not a new one. |
| Table footer: "Mostrando N–M de TOTAL" | companies.html:76 | done | page.tsx (`l.showingRange`) | |
| Table footer: Anterior/Siguiente pager | companies.html:76 | done | page.tsx (`pageHref`), bounded (`PAGE_SIZE=50`, never a full 14,240-row scan) | |
| Empty state (no rows) | contacts pattern | done | page.tsx (`l.noResults`) | |
| Search box in topbar | companies.html:37 | n/a (shell chrome) | — | Global topbar, out of scope for this page. |

## D1 — resolved (c05)

`company.industry`/`owner_bd_id`/`city`/`country` landed via `feat/company-fields-03-require-headers`
(migration 0017, merged into this chain at `75b2242`), backfilled in prod (industry 2,345, city
2,326, country 2,535, owner 571). `listMappers.ts`'s seam (built ahead of the merge, unit-tested)
needed no signature change — only `listQueries.ts`'s row-building started selecting the real
columns. Zero `pending D1` rows remain in this checklist.

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
- **c05** (`feat/mockup-port-c05-wire-company-fields` @ `75b2242` merge, `5763391` wiring):
  merged `feat/company-fields-03-require-headers` (D1 data layer), wired real Industria/
  Responsable into the table, "Mis empresas" onto the real owner, and added
  Industria/Responsable filters (index-backed).
