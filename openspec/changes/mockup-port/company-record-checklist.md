# /companies/[key] (record) — checklist vs `openspec/changes/crm-hubspot-ux/mockups/company-record.html`

Mockup note (company-record.html:62): the company record reuses the same three-panel
`RecordShell` as the contact record (left = about/properties, center = tabbed timeline,
right = associations). The visual redesign of the shell itself ships in a later change — this
change wires the company record into the *existing* shell components, same as `/contacts/[id]`.

Reference implementation: `src/app/(app)/contacts/[id]/page.tsx` +
`AboutPane.tsx`/`RecordTabs.tsx`/`Timeline.tsx` in the same folder.

Current state before this change: `src/app/(app)/companies/[key]/page.tsx` is flat (back-link,
header, stage badge via inline styles, notes box, `ActivityTimeline`, two admin buttons) — no
three-panel layout, no quick actions, no tabs, no associations panel. Every row is `todo` unless
noted.

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Left panel: company logo chip (lg) + name + headline (domain · industries) | company-record.html:65 | todo | — | Headline = `domain` + best-effort industry text (see D1 in companies-checklist.md); "—" until industry is decided. |
| Left panel: stage badge + "Contratando" badge | company-record.html:65 | todo | — | "Contratando" badge shows only when `getHiringMatchIndex` has >=1 open posting for this company/aliases. |
| Quick actions row (Nota, Tarea, Contacto, Reunión, Más) | company-record.html:66 | deviation | — | Contact record's `QuickActions.tsx` is person-scoped (logs against a `person_id`). A company-scoped "Nota"/"Tarea" needs an activity row scoped to `company_key` (already supported by `activity` table + `getActivitiesByCompany`), but "Contacto" (create a contact under this company) and "Reunión" don't have an existing action. D3: build company-scoped Nota/Tarea now (data exists), stub Contacto/Reunión as `Próximamente` until the owner confirms scope, matching the "disabled control only for structural chrome, only when orchestrator says so" rule. |
| Section title "Información de la empresa" + `dl.props` | company-record.html:67-68 | todo | — | Reuse `PropertyList.tsx` pattern from contacts for consistent edit affordances. |
| Prop: Etapa (badge + inline edit pencil) | company-record.html:69 | todo | — | Wraps existing `updateCompany` action; edit UX mirrors contact record's inline property edit (PR 09b2 per contacts/[id]/page.tsx:37 comment). |
| Prop: Responsable (owner chip + edit) | company-record.html:70 | deviation | — | Same D1 dependency as the list — no real owner field yet. |
| Prop: Potencial de ingresos (edit) | company-record.html:71 | todo | — | Maps to existing `revenuePotential` column. |
| Prop: Sede (Buenos Aires, Argentina) | company-record.html:72 | deviation | — | No location field on `company`. Same options as D1 (migrate a column, or derive from linked contacts' city/country) — owner decision. |
| Prop: Startup classification + "Clasificación por IA" hint | company-record.html:73 | deviation | — | No AI-startup-classification data source found on `company` or `person`; `isStartup`/`startupReason` exist per-person in outreach (`src/lib/contacts/outreachViewParams.ts` references), not per-company. Needs an owner decision on whether to aggregate from contacts or skip this prop entirely. |
| Tabs: "Actividad" / "Señales de contratación" | company-record.html:76 | todo | — | Reuse `RecordTabs.tsx` verbatim (same component, new tab content). |
| Activity tab: timeline toolbar filter pills (Todas/Notas/Cambios de etapa/Actividad de contactos) | company-record.html:78 | todo | — | "Actividad de contactos" is a new filter dimension: activity rows belonging to *people at this company*, not just company-scoped activity rows — needs a query that unions both, bounded and paginated like `Timeline.tsx`. |
| Activity tab: timeline entries (email/stage-change/note icons+cards) | company-record.html:80-82 | todo | — | Reuse `Timeline.tsx` rendering; effective time via `deriveStatus.ts`'s `originalAt` handling (see companies-checklist.md notes), not `created_at` directly. |
| Hiring signals tab: table (Cargo, Ubicación, Mercado, Publicado) | company-record.html:84-87 | todo | — | Source: `getHiringMatchIndex`'s postings for this company + aliases; bounded (cap rows, paginate if a company has many postings). |
| Right panel: "Contactos" assoc card (count, up to N rows: avatar, name→contact record, title, status badge) + "Ver los N en Contactos" link | company-record.html:90 | todo | — | Query `person` by `companyKey` (+ aliases), cap the inline list (e.g. 3-5 like the mockup), link to `/contacts?...` filtered by company for the "ver todos" link. |
| Right panel: "Vacantes" stat card (value + "N vacantes de IT abiertas · X LATAM · Y US") | company-record.html:91 | todo | — | Same `getHiringMatchIndex` result as the list's Vacantes column and the hiring-signals tab, computed once per request (already cached per the task brief) and reused across all three. |
| Right panel: "Tareas abiertas" card | company-record.html:92 | deviation | — | No task-to-company association found (tasks are being rebuilt by another agent in parallel on `src/app/(app)/tasks/*`, out of scope for this branch per coordination note). D4: stub as empty/"Próximamente" until the tasks work lands and exposes a company-scoped query; revisit once that agent's branch merges. |
| Breadcrumb "Empresas / <company name>" | company-record.html:36 | todo | — | Simple breadcrumb, same pattern as topbar chrome elsewhere. |

## Deviations needing an owner decision

- **D1** — see companies-checklist.md: no `industry`, `owner_bd_id`, or location columns on
  `company`. Affects Industria/Responsable (list) and Responsable/Sede (record) consistently —
  should be decided once, not per-page.
- **D3** — company-scoped quick actions: build Nota/Tarea now (data model supports it via
  `activity.companyKey`); "Contacto" (new contact under this company) and "Reunión" have no
  existing action to bind to. Recommend building Nota/Tarea for real and shipping
  Contacto/Reunión as `title="Próximamente"` until scoped, rather than silently omitting them
  (ui-builder.md's "never omit an element silently" rule).
- **D4** — "Tareas abiertas" card depends on a company↔task association that doesn't exist yet
  and belongs to the tasks rebuild happening in parallel (`src/app/(app)/tasks/*`, explicitly
  out of scope here per the coordination note). Ship the card shell with an empty/coming-soon
  state now; wire the real query once that work exposes one.
- **Startup classification prop** — no per-company AI classification data source was found.
  Needs an explicit decision: aggregate from `person`-level startup signals, or drop the prop
  from this page until a real source exists.

## Notes

- `/companies/new` is in scope per the task but has no dedicated mockup in
  `openspec/changes/crm-hubspot-ux/mockups/` (no `company-new.html`). Treat the contact-creation
  flow's form conventions (if any) as the pattern, or keep the existing form's fields but restyle
  with the shared design tokens — flagged as its own row set once list+record are done.
