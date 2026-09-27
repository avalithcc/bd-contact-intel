# /companies/[key] (record) — checklist vs `openspec/changes/crm-hubspot-ux/mockups/company-record.html`

Mockup note (company-record.html:62): the company record reuses the same three-panel
`RecordShell` as the contact record. Per the owner: this change IS the later change the mockup
refers to — build it exactly as shown, not as a shell stub.

Reference implementation: `src/app/(app)/contacts/[id]/page.tsx` +
`AboutPane.tsx`/`RecordTabs.tsx`/`Timeline.tsx` in the same folder.

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Left panel: company logo chip (lg) + name + headline (domain · industria) | company-record.html:65 | done, industria pending D1 | `CompanyAboutPane.tsx` | Headline joins `company.domain` and `industryLabel()` (pending-D1 "—" until the parallel data branch merges). |
| Left panel: stage badge + "Contratando" badge | company-record.html:65 | done | `CompanyAboutPane.tsx`, `getHiringMatchIndex()` | "Contratando" shows only when the hiring index has `openItCount > 0` for this key. |
| Quick actions row (Nota, Tarea, Contacto, Reunión, Más) | company-record.html:66 | done, "Más" open item | `CompanyQuickActions.tsx` | Nota/Tarea write through `createActivityAction`/`createTaskAction`'s existing `companyKey` param — no core change needed. Contacto reuses `NewContactDialog` (new `initialCompany` prop). Reunión: new `logCompanyMeetingAction` wrapping the already subject-agnostic `planMeeting`. "Más" has no destination in the mockup — left inert, see "Still open" below. |
| Section title "Información de la empresa" + `dl.props` | company-record.html:67-68 | done | `CompanyAboutPane.tsx` | Own inline-edit rows (not a literal `PropertyList.tsx` reuse — a company has a different, smaller property set). |
| Prop: Etapa (badge + inline edit pencil) | company-record.html:69 | done | `CompanyAboutPane.tsx`, `updateCompanyStageAction` | Also now logs a `status_change` activity on real change (didn't before — see companies/actions.ts). |
| Prop: Responsable (owner chip + edit) | company-record.html:70 | pending D1 | `listMappers.ts` `ownerLabel` | Read-only "—", no edit affordance until `owner_bd_id` exists. |
| Prop: Potencial de ingresos (edit) | company-record.html:71 | done | `CompanyAboutPane.tsx`, `updateCompanyAction` | |
| Prop: Sede (Buenos Aires, Argentina) | company-record.html:72 | pending D1 | `listMappers.ts` `locationLabel` | |
| Prop: Startup classification + hint | company-record.html:73 | done | `recordMappers.ts` `startupLabel`, `HiringMatch.isStartup/startupReason` | "—" for a company that isn't a current hiring target. The mockup's "Clasificación por IA, 12 sep" dated hint has no backing timestamp on `target_company` — shown without a date, not fabricated. |
| Tabs: "Actividad" / "Señales de contratación" | company-record.html:76 | done | `RecordTabs.tsx` (reused verbatim), `page.tsx` | |
| Activity tab: filter pills (Todas/Notas/Cambios de etapa/Actividad de contactos) | company-record.html:78 | done | `CompanyTimeline.tsx`, `recordMappers.ts` `filterTimelineRows` (unit-tested) | |
| Activity tab: timeline entries | company-record.html:80-82 | done | `CompanyTimeline.tsx`, `recordQueries.ts` `getCompanyTimeline` | Own renderer, not `Timeline.tsx` reused verbatim — see CompanyTimeline.tsx's doc comment for why (person-only machinery: LinkedIn threads, merge cards, admin reveal). Reuses the generic `groupTimelineEntries` for month bucketing. Effective time via the real `effectiveActivityAtSql`/`resolveEffectiveActivityAt` (corrected in c02/c03 after the c01 misdiagnosis). |
| Hiring signals tab: table (Cargo, Ubicación, Mercado, Publicado) | company-record.html:84-87 | done | `page.tsx`, `getCompanyPostingsForKey` | |
| Right panel: "Contactos" assoc card | company-record.html:90 | done | `recordQueries.ts` `getCompanyPeople`, `page.tsx` | Matches `person.company_key` directly, not alias-resolved — same known limitation as the list's contacts count (todo, not a blocker). |
| Right panel: "Vacantes" stat card | company-record.html:91 | done | `recordMappers.ts` `marketBreakdown` (unit-tested), `getCompanyPostingsForKey` | Real per-market counts from this company's own postings, not approximated from the ranking index's offshore/LATAM-only fields. |
| Right panel: "Tareas abiertas" card | company-record.html:92 | done | `recordQueries.ts` `getCompanyOpenTasks`, `completeCompanyTaskAction` | Bounded: `status='open' AND (company_key=X OR person_id IN people-at-X)`. Mark-done wired (reuses existing `completeTaskAction`). |
| Breadcrumb "Empresas / <company name>" | company-record.html:36 | done | `page.tsx` | |

## Resolved in c01→c03 (corrections along the way)

- D1 (industry/owner_bd_id/city/country): owner-approved, pending merge of `feat/company-fields-01…`. Seam built and shared between list and record (`listMappers.ts`).
- Startup classification: real, already-available (`HiringMatch.isStartup/startupReason`) — no owner decision was actually needed.
- "Tareas abiertas": real, already-available (`task.companyKey`/`task.personId`) — no owner decision was actually needed.
- Quick actions Contacto/Reunión: both built for real (see table above).

## Still open (real, small, not blocking)

- **"Más" quick action** — mockup's 5th icon has no specified menu contents. Left as a disabled/inert control (`title="Próximamente"`). Needs a product decision on what it should open, if anything.
- **Contactos-per-company / people list / open-tasks crossover** all match `person.company_key` directly, not through `company_alias` (same known limitation flagged in companies-checklist.md). Low priority, a real fix not a decision.
- **"Contacto" quick action's trigger button** renders with `NewContactDialog`'s own `.btn.btn-primary` style, not the `.qa` icon-button style the other 4 quick actions use — that dialog isn't built to accept a custom trigger element. Small visual inconsistency vs. the mockup's uniform 5-icon row, not a functional gap.
- **Startup "Clasificación por IA, 12 sep" hint** — no classification timestamp exists on `target_company`; the label renders without a date rather than fabricating one.

## Notes

- `/companies/new` has no dedicated mockup (no `company-new.html` in the mockups folder). Its own checklist/build is c04+.
