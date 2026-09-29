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
| "Generar mensaje con IA" secondary block button + standalone dialog | contact-record.html:73, 186-196 | done (email-gen-03) | QuickActions.tsx (`generate` quick action + `Dialog` + `GenerateMessageDialog.tsx`) | Owner direction 2026-09-26 closed the two gaps below: "Canal" select (email default / linkedin) posts `channel` to `generatePersonOutreachMessageAction`; "Señales utilizadas" chips render `state.signals` (src/lib/outreach/messageSignals.ts — derived from the prompt input, never the model's output) via `formatOutreachSignalLabel`. |
| "Sobre este contacto" section title + "Historial" ghost button | contact-record.html:74 | done (r02) | AboutPane.tsx | "Historial" kept as the mockup's own inert `href="#"` (no destination in the approved design either). |

## Left pane — property list

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Estado (derived) row + badge | contact-record.html:76 | done (r02) | PropertyList.tsx (`.prop.derived`) | |
| Estado "why" derivation reason line | contact-record.html:77 | done (r02) | `src/lib/status/deriveStatus.ts` (`deriveStatusFull`, `buildStatusReasonEvidence`), `src/lib/contacts/labels.ts` (`describeStatusReason`), `queries.ts` | Fully unit-tested (deriveStatusFull, buildStatusReasonEvidence, describeStatusReason). Reuses the SAME effective-time logic the status cache itself uses — the reason can never disagree with `person.status`. |
| Responsable row (owner chip w/ avatar + hint) | contact-record.html:78 | done (r02) | PropertyList.tsx, `ownerHintOldestConnection` | |
| Correo electrónico row + Verified badge + Hunter hint | contact-record.html:79 | done (r02) | PropertyList.tsx, `hunterHint` | |
| Cargo / Grupo de rol / Nivel / Ubicación / Industria rows | contact-record.html:80-84 | done (corrected 2026-09-28) | PropertyList.tsx, `src/lib/contacts/locationDisplay.ts` | **This row previously claimed "done" and was wrong.** The mockup shows ONE `Ubicación` row composing city and country (region is never shown); the build rendered three separate editable rows, Ciudad / Región / País, and an em-dash row when region was null. Now a single composed row that expands into the three real inputs on edit, so each field keeps its own audit history. |
| Origen row | contact-record.html:85 | done (r02) | `queries.ts` (`ContactSourceEvidence`, bounded `person_id_map`/`lead` join) | "LinkedIn (N BDs)" from connection count + "Lista de leads X" from the mapped legacy lead's `sourceKey`, when one exists. |
| Creado row | contact-record.html:86 | done (r02) | page.tsx (`createdText`) | |

## Center — tabs

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Actividad / Resumen tabs | contact-record.html:89-91 | done (r03) | RecordTabs.tsx | Onto `.tabs`/`.tab` design-system classes. |

## Center — Actividad tab

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Filter pills w/ icons + counts | contact-record.html:95-101 | done (corrected 2026-09-28) | Timeline.tsx, `src/lib/activity/timelinePills.ts` | **This row previously claimed "done (r03)" and was wrong.** The build rendered the raw activity enum — `Nota · Correo · Búsqueda de correo · Cambio de estado · Reunión · Llamadas · Descarte · Estado respaldado` — where the mockup groups for the reader. `status_backfill` alone holds 3,517 production rows, so a migration artifact was the page's most prominent filter. Pills are now `Todo · Notas · Llamadas · Correos · Reuniones · Tareas · Sistema`, with `Sistema` grouping hunter_lookup + status_change + discarded + status_backfill. One mockup pill is deliberately absent: **LinkedIn** (that surface is being turned off). **Tareas** (contact-record.html:104) shipped separately — see the dedicated row below. |
| "Tareas" filter pill | contact-record.html:104 | done (timeline-tasks-pill) | Timeline.tsx, `src/lib/tasks/queries.ts#getTasksForPerson`, `src/lib/contacts/timelineTasks.ts` | Was the one open row this file tracked (see the old "open" note below, kept for history). Selecting it shows the Contact's tasks as timeline cards: open ones first (title, due-date badge, assignee, "Marcar como hecha"/"Reprogramar" — same card as "Próximas"), then a **"Completadas"** group for done tasks (badge + a new "Reabrir" action, `reopenContactTaskAction`) — a state the mockup itself never renders (no completed-task example exists anywhere in the mockup set), so this group's shape is this session's own construction, not a pixel-matched port. **"Todo"'s own count now includes tasks** (open+done): the mockup's own arithmetic pins this — contact-record.html:98's "Todo 15" equals the sum of every other pill shown, including "Tareas 2" — even though no Tareas-pill-selected screenshot exists to confirm the rest of the behavior. Both counts are read from `getTasksForPerson`'s own `count(*) over ()` (true, never capped by its bounded row reads). |
| "Más recientes primero" sort toggle | contact-record.html:102 | done, static (r03) | Timeline.tsx | Inert — the timeline has exactly one sort order today, same as the static mockup shows no alternate state. |
| Pinned note composer (`#log-note`) + "Agregar tarea de seguimiento" | contact-record.html:104-105 | done (r03) | NoteComposer.tsx | Follow-up toggle reveals a title input and creates a real task via the existing `addContactTaskAction`, no due date — documented interpretation (mockup shows no sub-fields). |
| "Próximas" upcoming-task group + "Marcar como hecha"/"Reprogramar" | contact-record.html:107-111 | done (r03), partial | Timeline.tsx, CompleteTaskButton.tsx, `getTasksForPerson` (renamed from `getOpenTasksForPerson`, timeline-tasks-pill), `completeContactTaskAction` | "Marcar como hecha" is real (bounded query + ownership-scoped `setTaskStatusForPerson`). "Reprogramar" stays inert (mockup has no wired destination for it either). |
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
| "Generar mensaje" wide dialog | contact-record.html:186-196 | done (email-gen-03) | QuickActions.tsx / GenerateMessageDialog.tsx | See the quick-actions row above — "Canal"/"Señales utilizadas" now implemented. |
| "Registrar reunión" / "Descartar contacto" / "Crear tarea" / "Enviar correo" dialogs | contact-record.html:197-219 | done (pre-existing) | QuickActions.tsx | Unchanged this session — already matched closely; markup now uses `.field`/`.input`/`.textarea`/`.bar` global classes (r02) instead of local CSS. "Crear tarea" still has no "Asignado a" picker (pre-existing gap, not touched). |

## Summary counts (updated after r02-r08)

- done: ~52
- todo rows remaining: 0
- n/a (superseded by a design decision, not a gap): 1 (post-reveal toast on the separate audited page — the inline reveal path this session shipped doesn't navigate away, so there's no "return" moment; the deep-link page's own toast, if still wanted, is a tiny separate follow-up)
- deviations applied per owner decision this session: 2 (admin inline reveal is click-to-expand, not eager; "Pegar señal" kept and styled)
- flagged for future owner input (not silently built): 0 (the two Generar-mensaje gaps — "Canal" select, "Señales utilizadas" chips — were closed per owner direction 2026-09-26; see the email-gen-01..03 branch chain)

**Checklist status: zero open rows (closed by branch `feat/timeline-tasks-pill`).**

- **closed:** the `Tareas` filter pill (`contact-record.html:97-106` /
  `:104`). Was open because tasks weren't timeline entries; now selecting it
  shows the Contact's open + done tasks as timeline cards (see the dedicated
  row above, "Center — Actividad tab"). Two decisions made without a matching
  mockup screenshot to pixel-check against (mockup only ever shows the "Todo"
  pill selected): "Todo"'s count includes tasks (derived from the mockup's
  own count arithmetic), and a done task gets a "Completadas" group + a new
  "Reabrir" action (the mockup has no completed-task example at all).
- **deliberately absent:** the `LinkedIn` pill, because that whole surface is
  being turned off (2026-09-28).

**Read this before trusting any row above.** On 2026-09-28 the owner reviewed
the live page and said it did not match the mockup, while this checklist
claimed zero open rows. An element-by-element audit found two rows marked
"done" that did not hold — the filter pills and the Ubicación row, both
corrected above. A row here means someone believed the work was done, not that
anyone diffed it against the mockup. The mockup HTML is the standard; this file
is a record of intent.

Everything server-action-preserving: every existing server action kept its
exact signature and semantics; only new bounded reads and two new actions
(`completeContactTaskAction` wrapping the existing `completeTaskAction`,
`revealAdminConversationAction` wrapping the existing `getConversationForAdmin`)
were added.
