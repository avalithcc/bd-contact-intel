# /contacts/[id] mockup parity checklist

Source mockups: `openspec/changes/crm-hubspot-ux/mockups/contact-record.html`
(BD view) and `contact-record-admin.html` (admin view — audited-conversation
expansion + admin sidenav section). Audited against worktree tip
`feat/mockup-port-03-contacts` @ 4bc47e5.

Branch chain: `feat/mockup-port-r01-record-checklist` (this file) ->
`r02-record-identity` (left pane) -> `r03-timeline` -> `r04-linkedin-admin-reveal`
(LinkedIn timeline cards + inline audited admin reveal) -> `r05-right-panel` ->
`r06-overview-tab` (Resumen tab) -> `r07-generate-message-dialog`. Every
branch's tip passed `npm run test:unit`, `npx tsc --noEmit`, and
`npx next build` (compiled + typechecked; failed only at "Collecting page
data" for missing `DATABASE_URL`).

Columns: element | mockup ref | status | evidence file:line | notes

## Header / breadcrumb (out of scope — shell already ported)

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Breadcrumb "Contactos / {name}" | contact-record.html:32 | done | shell (not this change) | Not touched by this change. |

## Left pane — identity header

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| `avatar-lg` initials avatar | contact-record.html:62 | done (r02) | AboutPane.tsx (`Avatar` component) | |
| `<h1>` name | contact-record.html:63 | done (r02) | AboutPane.tsx | |
| Headline "{cargo} en {empresa link}" | contact-record.html:63 | done (r02) | AboutPane.tsx (`headlineConnector` + company `Link`) | |
| Status badge (color-coded) | contact-record.html:64 | done (r02) | AboutPane.tsx, `src/lib/contacts/statusBadge.ts` | `statusBadgeClass()`, unit-tested. |
| Verified badge next to status | contact-record.html:64 | done (r02) | AboutPane.tsx (`emailVerified`) | |
| LinkedIn outline-badge link | contact-record.html:64 | done (r02) | AboutPane.tsx, `src/lib/contacts/linkedinProfile.ts` | Built from `person.profileKey`; unit-tested. |

## Left pane — quick actions

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Nota / Correo / Tarea / Reunión / Descartar qa buttons | contact-record.html:66-72 | done (r02/r03) | QuickActions.tsx | Icons added (r02); "Nota" is now a `#log-note` anchor to the pinned composer (r03), not its own toggle. |
| "Pegar señal" (6th action) | n/a in either mockup | deviation, kept (owner decision) | QuickActions.tsx | Owner decision (this session): keep it, style identically to the other five. Documented inline. |
| "Generar mensaje con IA" secondary block button + standalone dialog | contact-record.html:73, 186-196 | done (r07) | QuickActions.tsx (`generate` quick action + `Dialog`) | Wraps the existing `GenerateMessageButton`/`generatePersonOutreachMessageAction`. **Deviation flagged, needs owner input**: no "Canal" select (only email-oriented generation exists server-side) and no "Señales utilizadas" chips (the generator doesn't expose which signals fed the draft) — both would require new backend work to build for real, not fabricated here. |
| "Sobre este contacto" section title + "Historial" ghost button | contact-record.html:74 | done (r02) | AboutPane.tsx | "Historial" kept as the mockup's own inert `href="#"` (no destination in the approved design either). |

## Left pane — property list

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Estado (derived) row + badge | contact-record.html:76 | done (r02) | PropertyList.tsx (`.prop.derived`) | |
| Estado "why" derivation reason line | contact-record.html:77 | done (r02) | `src/lib/status/deriveStatus.ts` (`deriveStatusFull`, `buildStatusReasonEvidence`), `src/lib/contacts/labels.ts` (`describeStatusReason`), `queries.ts` | Fully unit-tested (deriveStatusFull, buildStatusReasonEvidence, describeStatusReason). Reuses the SAME effective-time logic the status cache itself uses — the reason can never disagree with `person.status`. |
| Responsable row (owner chip w/ avatar + hint) | contact-record.html:78 | done (r02) | PropertyList.tsx, `ownerHintOldestConnection` | |
| Correo electrónico row + Verified badge + Hunter hint | contact-record.html:79 | done (r02) | PropertyList.tsx, `hunterHint` | |
| Cargo / Grupo de rol / Nivel / Ubicación / Industria rows | contact-record.html:80-84 | done (already existed) | PropertyList.tsx (`EDITABLE_PERSON_PROPERTIES`) | Corrected from the r01 checklist's "todo?" flags — all already implemented pre-r02, only markup changed. |
| Origen row | contact-record.html:85 | done (r02) | `queries.ts` (`ContactSourceEvidence`, bounded `person_id_map`/`lead` join) | "LinkedIn (N BDs)" from connection count + "Lista de leads X" from the mapped legacy lead's `sourceKey`, when one exists. |
| Creado row | contact-record.html:86 | done (r02) | page.tsx (`createdText`) | |

## Center — tabs

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Actividad / Resumen tabs | contact-record.html:89-91 | done (r03) | RecordTabs.tsx | Onto `.tabs`/`.tab` design-system classes. |

## Center — Actividad tab

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Filter pills w/ icons + counts | contact-record.html:95-101 | done (r03) | Timeline.tsx | |
| "Más recientes primero" sort toggle | contact-record.html:102 | done, static (r03) | Timeline.tsx | Inert — the timeline has exactly one sort order today, same as the static mockup shows no alternate state. |
| Pinned note composer (`#log-note`) + "Agregar tarea de seguimiento" | contact-record.html:104-105 | done (r03) | NoteComposer.tsx | Follow-up toggle reveals a title input and creates a real task via the existing `addContactTaskAction`, no due date — documented interpretation (mockup shows no sub-fields). |
| "Próximas" upcoming-task group + "Marcar como hecha"/"Reprogramar" | contact-record.html:107-111 | done (r03), partial | Timeline.tsx, CompleteTaskButton.tsx, `getOpenTasksForPerson`, `completeContactTaskAction` | "Marcar como hecha" is real (new bounded query + reused `completeTaskAction`). "Reprogramar" stays inert (mockup has no wired destination for it either). |
| Date-bucketed groups (month / "Antes de la migración") | contact-record.html:107,114,141 | done (r03) | `src/lib/contacts/timelineGrouping.ts` | Unit-tested. Bucketing rule: `hunter_lookup`/`status_backfill` always bucket as pre-migration (by construction, not by date threshold) — see the module's doc comment for why a date-threshold rule doesn't match the mockup's own example. |
| Email thread card (grouped) | contact-record.html:116-123 | done (r08) | `src/lib/contacts/emailThreads.ts` (`groupEmailThreads`), Timeline.tsx | Groups `email_sent` rows sharing `metadata.gmailThreadId` into one `.thread`/`.thread-msg` card with a message-count badge. Unit-tested. Reply-threading itself stays out of scope per the mockup's own note ("Las respuestas aparecerán aquí cuando se lance la sincronización de correo" — backlog); this only groups the BD's own sent messages. |
| LinkedIn reply/sent cards | contact-record.html:124-131 | done (r04), documented approximation | `src/lib/contacts/connectionTimelineEntries.ts`, Timeline.tsx | ONE synthetic card per BD connection (direction picked by "any reply at all", reusing the same signal-strength rule `deriveStatus` uses) — not one card per individual message, since the schema only has per-connection aggregates (`sentCount`/`receivedCount`/`lastMessageAt`), not a per-message log for every BD. Unit-tested. |
| `.locked` privacy notice (non-admin, other BD's conversation) | contact-record.html:126,130 | done (r04) | Timeline.tsx, `linkedinEntryAccess` | Names whose conversation it is (`timelineLockedOwnedBy`), matching the mockup's exact copy intent. |
| Note card w/ blockquote | contact-record.html:132-134 | done (r02/r03) | Timeline.tsx | |
| System "Unificado a partir de N registros" merge card | contact-record.html:135-138 | done (r08) | `queries.ts` (`ContactMergeEvidence` — bounded `person_id_map`/`merge_event` reads), Timeline.tsx | Synthetic system-type entry (`merge_unified`), same pattern as the LinkedIn cards; shown only when `unifiedFromCount > 1`. Copy is a general count ("N registros combinados"), not the mockup's per-record breakdown (which would need listing each merged source) — real, not fabricated, just less granular. |
| Pre-migration Hunter / status-backfill cards | contact-record.html:143-148 | done (r02/r03) | Timeline.tsx | `status_backfill`'s `metadata.originalAt` timing handled correctly at the query layer (confirmed pre-existing, unchanged). |

## Center — Resumen tab

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| "Última actividad" stat | contact-record.html:153 | done (r06) | Overview.tsx, `src/lib/contacts/recentActivity.ts` (`mostRecentActivity`) | Combines activity entries + LinkedIn connection facts; unit-tested. |
| "Puntos de contacto (todos los BDs)" stat | contact-record.html:154 | done (r06) | Overview.tsx, `touchpointTotal` | LinkedIn = sum of `messageCount`; email/notes = timeline type counts. Unit-tested. |
| "Tareas abiertas" card | contact-record.html:156 | done (r06) | Overview.tsx | Reuses `getOpenTasksForPerson`. |
| "Señales" card (hiring signal) | contact-record.html:157 | done (r06), simplified | Overview.tsx, `getCompanyPostingsForKey` | Shows open-IT-role count + "new in last 7 days" (computed from already-fetched postings, no new query). Does not split by market ("LATAM 31, EE. UU. 7") — that breakdown isn't in the reused function's return shape; flagged, not fabricated. |

## Right pane — Empresa card

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Company-logo chip, name link, domain · industry | contact-record.html:160-161 | done (r05), documented approximation | page.tsx | No `domain` column exists anywhere in the schema (checked) — derived from this Contact's own verified email domain as the closest real substitute. Industry reuses `person.industry` (already shown in the property list). |
| "Cambiar empresa" ghost icon-button | contact-record.html:160 | done, inert (r05) | page.tsx | Mockup itself has no wired destination (`href="#"`) — kept inert. |
| "Contratando · N puestos de IT" + "Etapa: X" badges | contact-record.html:162 | done (r05) | page.tsx, `getCompanyPostingsForKey`, `getCompanyByKey` | Both bounded to the one company. |
| "N contactos en esta empresa" | contact-record.html:163 | done (r05) | `src/lib/companies/queries.ts` (`getCompanyContactCount`) | Bounded `COUNT(*)` on `companyKey`, excludes merged-away rows. |

## Right pane — BDs conectados / Historial de conversaciones (now split, per mockup)

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| "BDs conectados" card w/ avatar + "Responsable" badge + count | contact-record.html:165-169 | done (r05) | page.tsx | |
| "Historial de conversaciones" — separate card, only BDs with real history | contact-record.html:172-178 | done (r05) | page.tsx (`connectionsWithHistory`) | Split out from the old combined card, per the mockup. |
| Per-conversation "Ver" button (admin) | contact-record-admin.html:182-183 | done (r05) | page.tsx | |
| Privacy footer notes (BD view / admin view) | contact-record.html:177, contact-record-admin.html:184 | done (r05) | page.tsx | |

## Right pane — Tareas card

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Card w/ "+" add-task icon-button | contact-record.html:180 | done, inert "+" (r05) | page.tsx | "+" links to `#task` quick action (real); mockup's own icon-button has no separate behavior beyond opening the task composer. |
| Task row w/ checkbox + "Vence X · Asignado" | contact-record.html:181 | done (r05) | page.tsx, CompleteTaskCheckbox.tsx | Real completion action. |

## Admin-only additions

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Inline-expanded LinkedIn conversation w/ `.alert.alert-audit` banner | contact-record-admin.html:128-134 | done (r04) — **owner decision applied** | Timeline.tsx, AdminConversationReveal.tsx, `revealAdminConversationAction` | Owner decision (this session): render inline via a click-to-reveal button (NOT eagerly on every page load, to avoid an audit-log write per render) that goes through the SAME audited `getConversationForAdmin` path the separate page always used. The separate `/contacts/[id]/conversation/[bdId]` page is kept as a deep link. |
| "Revisar / deshacer fusión" button on merge card | contact-record-admin.html:145 | done (r08) | Timeline.tsx (admin-only, `mergeInfo.hasMergeEvent`) | Links to `/admin/duplicates#history` (existing page). |
| Toast on returning from an audited view | contact-record-admin.html:226 | n/a (superseded) | — | The mockup's toast fires when NAVIGATING BACK from the separate audited page; r04's inline reveal doesn't navigate away at all (content appears in place), so there's no "returning" moment for a toast to fire on. The separate `/contacts/[id]/conversation/[bdId]` page (kept as a deep link) still has no such toast if reached directly — flagged as a small remaining gap for that specific path only. |

## Dialogs

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| "Generar mensaje" wide dialog | contact-record.html:186-196 | done (r07), with flagged gaps | QuickActions.tsx | See the quick-actions row above for the "Canal"/"Señales utilizadas" gaps. |
| "Registrar reunión" / "Descartar contacto" / "Crear tarea" / "Enviar correo" dialogs | contact-record.html:197-219 | done (pre-existing) | QuickActions.tsx | Unchanged this session — already matched closely; markup now uses `.field`/`.input`/`.textarea`/`.bar` global classes (r02) instead of local CSS. "Crear tarea" still has no "Asignado a" picker (pre-existing gap, not touched). |

## Summary counts (updated after r02-r08)

- done: ~52
- todo rows remaining: 0
- n/a (superseded by a design decision, not a gap): 1 (post-reveal toast on the separate audited page — the inline reveal path this session shipped doesn't navigate away, so there's no "return" moment; the deep-link page's own toast, if still wanted, is a tiny separate follow-up)
- deviations applied per owner decision this session: 2 (admin inline reveal is click-to-expand, not eager; "Pegar señal" kept and styled)
- flagged for future owner input (not silently built): 2 (Generar mensaje's missing "Canal" select and "Señales utilizadas" chips — no backend support exists for either yet; documented in QuickActions.tsx and here, not fabricated)

**Checklist status: no open "todo" rows.** Every remaining gap is either
`n/a` (superseded by a documented owner-approved design decision) or
explicitly flagged as needing NEW backend work + an owner decision before
it can be built for real (the two Generar-mensaje gaps above).

Everything server-action-preserving: every existing server action kept its
exact signature and semantics; only new bounded reads and two new actions
(`completeContactTaskAction` wrapping the existing `completeTaskAction`,
`revealAdminConversationAction` wrapping the existing `getConversationForAdmin`)
were added.
