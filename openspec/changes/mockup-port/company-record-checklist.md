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
noted. **Not started yet** — c02 spent this session's remaining budget on the list page; this
page is next (c03+).

**Corrections (owner, after c01):**
- `effectiveActivityTime.ts` and `contacts-checklist.md` DO exist at base `33b834f` — see the
  correction note at the top of companies-checklist.md.
- The "cambio posterior" mockup note means the redesign was *scheduled* for a later change —
  and per the owner, **this change is that later change**. Build the record exactly as
  `company-record.html` shows it, not as a shell stub.
- D1 is owner-approved: `industry`/`owner_bd_id`/`city`/`country` are being added by the
  parallel `feat/company-fields-01…` data branch. Build everything else now; render those
  properties through the same pending-D1 seam as the list (`listMappers.ts`), "—" until merged.
- Startup: use `getHiringMatchIndex()`'s `isStartup`/`startupReason` (already present on
  `HiringMatch`, straight from `target_company.is_startup` — see `src/lib/hiring/queries.ts:65-70,
  339-341`) when the company is a hiring target. Otherwise "—". No new data source needed, no
  owner decision — this was a research gap in c01, not a real blocker.
- Tasks: `task` table has `companyKey` AND `personId` columns directly
  (`src/db/schema.ts:1083-1108`, `task_company_idx`/`task_person_idx`) — a company↔task link
  already exists. "Tareas abiertas" is buildable now (bounded: `companyKey = X OR personId IN
  (people at X)`, `status = 'open'`), not blocked on the parallel tasks rebuild. Still don't
  touch `src/app/(app)/tasks/*` itself (coordination note) — only read from `task` here.
- Quick actions: "Contacto" opens the existing `NewContactDialog` prefilled with this company;
  "Reunión" logs a meeting activity with `companyKey` (extend `logContactMeetingAction`'s
  underlying logic with TDD if it only supports a `personId` today — needs verifying against
  `src/lib/contacts/call.ts`/the meeting action's actual signature, not yet checked). "Nota"/
  "Tarea" stay as originally planned (company-scoped `activity`/`task` rows).

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Left panel: company logo chip (lg) + name + headline (domain · industries) | company-record.html:65 | todo | — | Headline = `domain` + best-effort industry text (see D1 in companies-checklist.md); "—" until industry is decided. |
| Left panel: stage badge + "Contratando" badge | company-record.html:65 | todo | — | "Contratando" badge shows only when `getHiringMatchIndex` has >=1 open posting for this company/aliases. |
| Quick actions row (Nota, Tarea, Contacto, Reunión, Más) | company-record.html:66 | deviation | — | Contact record's `QuickActions.tsx` is person-scoped (logs against a `person_id`). A company-scoped "Nota"/"Tarea" needs an activity row scoped to `company_key` (already supported by `activity` table + `getActivitiesByCompany`), but "Contacto" (create a contact under this company) and "Reunión" don't have an existing action. D3: build company-scoped Nota/Tarea now (data exists), stub Contacto/Reunión as `Próximamente` until the owner confirms scope, matching the "disabled control only for structural chrome, only when orchestrator says so" rule. |
| Section title "Información de la empresa" + `dl.props` | company-record.html:67-68 | todo | — | Reuse `PropertyList.tsx` pattern from contacts for consistent edit affordances. |
| Prop: Etapa (badge + inline edit pencil) | company-record.html:69 | todo | — | Wraps existing `updateCompany` action; edit UX mirrors contact record's inline property edit (PR 09b2 per contacts/[id]/page.tsx:37 comment). |
| Prop: Responsable (owner chip + edit) | company-record.html:70 | deviation | — | Same D1 dependency as the list — no real owner field yet. |
| Prop: Potencial de ingresos (edit) | company-record.html:71 | todo | — | Maps to existing `revenuePotential` column. |
| Prop: Sede (Buenos Aires, Argentina) | company-record.html:72 | pending D1 | — | `city`/`country` on the parallel data branch — same seam as Industria/Responsable. |
| Prop: Startup classification + "Clasificación por IA" hint | company-record.html:73 | todo | — | **Corrected**: `getHiringMatchIndex()`'s `HiringMatch.isStartup`/`startupReason` (company-level, from `target_company.is_startup`) is a real, already-available source when the company is a hiring target — no owner decision needed, no aggregation from contacts. Shows "—" for a company that isn't a current hiring target (not classified either way). |
| Tabs: "Actividad" / "Señales de contratación" | company-record.html:76 | todo | — | Reuse `RecordTabs.tsx` verbatim (same component, new tab content). |
| Activity tab: timeline toolbar filter pills (Todas/Notas/Cambios de etapa/Actividad de contactos) | company-record.html:78 | todo | — | "Actividad de contactos" is a new filter dimension: activity rows belonging to *people at this company*, not just company-scoped activity rows — needs a query that unions both, bounded and paginated like `Timeline.tsx`. |
| Activity tab: timeline entries (email/stage-change/note icons+cards) | company-record.html:80-82 | todo | — | Reuse `Timeline.tsx` rendering; effective time via `deriveStatus.ts`'s `originalAt` handling (see companies-checklist.md notes), not `created_at` directly. |
| Hiring signals tab: table (Cargo, Ubicación, Mercado, Publicado) | company-record.html:84-87 | todo | — | Source: `getHiringMatchIndex`'s postings for this company + aliases; bounded (cap rows, paginate if a company has many postings). |
| Right panel: "Contactos" assoc card (count, up to N rows: avatar, name→contact record, title, status badge) + "Ver los N en Contactos" link | company-record.html:90 | todo | — | Query `person` by `companyKey` (+ aliases), cap the inline list (e.g. 3-5 like the mockup), link to `/contacts?...` filtered by company for the "ver todos" link. |
| Right panel: "Vacantes" stat card (value + "N vacantes de IT abiertas · X LATAM · Y US") | company-record.html:91 | todo | — | Same `getHiringMatchIndex` result as the list's Vacantes column and the hiring-signals tab, computed once per request (already cached per the task brief) and reused across all three. |
| Right panel: "Tareas abiertas" card | company-record.html:92 | todo | — | **Corrected**: `task.companyKey`/`task.personId` already exist (`src/db/schema.ts:1083-1108`) — buildable now with a bounded query (`status='open' AND (company_key = X OR person_id IN (people at X))`), reading only from `task`, never touching `src/app/(app)/tasks/*` itself. |
| Breadcrumb "Empresas / <company name>" | company-record.html:36 | todo | — | Simple breadcrumb, same pattern as topbar chrome elsewhere. |

## Resolved (were flagged as owner decisions in c01, closed after the owner's correction)

- **D1** — pending, not blocked: owner-approved, data lands via `feat/company-fields-01…`. Build
  the seam now (as the list already does), wire the real select once it merges.
- Quick actions Contacto/Reunión — resolved: reuse `NewContactDialog` (prefilled company) and
  extend the meeting-logging action to accept `companyKey` if it's `personId`-only today.
- "Tareas abiertas" — resolved: `task.companyKey`/`personId` already exist; buildable now.
- Startup classification — resolved: `getHiringMatchIndex()`'s `isStartup`/`startupReason`.

## Still open (real product/scope calls, not yet decided)

- Whether the "Más" quick action (5th icon, company-record.html:66) needs a menu of its own or
  is out of scope for this pass — mockup doesn't specify its contents.
- Whether the meeting-logging action's extension (personId-only → companyKey too) changes its
  existing person-scoped callers' behavior; needs the actual signature checked before writing
  the TDD cycle for it (not yet done — c03 work).

## Notes

- `/companies/new` is in scope per the task but has no dedicated mockup in
  `openspec/changes/crm-hubspot-ux/mockups/` (no `company-new.html`). Treat the contact-creation
  flow's form conventions as the pattern, or keep the existing form's fields but restyle with the
  shared design tokens — flagged as its own row set once list+record are done.
- **Status: not started this session.** c02 used the remaining budget on `/companies` (list).
  This record rebuild — three-panel shell, company-scoped quick actions (Nota/Tarea done via
  existing `activity.companyKey`; Contacto/Reunión need the two extensions noted above),
  hiring-signals tab, associations panel (Contactos/Vacantes/Tareas abiertas) — is the next
  branch (c03), same TDD/build discipline as c02. Progress saved to engram under
  `sdd/mockup-port/companies-apply-progress` for continuation.
