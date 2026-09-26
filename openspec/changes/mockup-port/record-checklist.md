# /contacts/[id] mockup parity checklist

Source mockups: `openspec/changes/crm-hubspot-ux/mockups/contact-record.html`
(BD view) and `contact-record-admin.html` (admin view — audited-conversation
expansion + admin sidenav section). Audited against worktree tip
`feat/mockup-port-03-contacts` @ 4bc47e5, which already rebuilt the shell,
`/contacts` list/board onto the mockup's global CSS classes
(`src/app/design-system.css`), but has NOT touched the record page — it is
still on the pre-mockup `page.module.css`/`AboutPane.module.css` markup.

One row per visible element; "evidence" is the file (or file:line once
edited) the element currently lives in, or "—" if not implemented at all.
"todo" means the underlying feature/data may already exist server-side but
the markup is not yet 1:1 with the mockup's global classes, OR the element
is fully missing.

Columns: element | mockup ref | status | evidence file:line | notes

## Header / breadcrumb (out of scope — shell already ported)

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Breadcrumb "Contactos / {name}" | contact-record.html:32 | done | src/app/(app)/Topbar (shell, not this change) | Not touched by this change. |

## Left pane — identity header

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| `avatar-lg` initials avatar | contact-record.html:62 | todo | AboutPane.tsx:55-59 (no avatar rendered at all) | Needs `initialsFromName` + a stable color class (`aN`), same helper `/contacts` list uses. |
| `<h1>` name | contact-record.html:63 | done (markup differs) | AboutPane.tsx:56 | Present but not under `.record-identity`; needs class rework. |
| Headline "{cargo} en {empresa link}" | contact-record.html:63 | todo | AboutPane.tsx (headline passed but company link not rendered inline in headline) | Mockup links the company name inside the headline sentence; current code renders headline as plain text and company link only in the right panel. |
| Status badge (color-coded, e.g. `badge-replied`) | contact-record.html:64 | todo | AboutPane.tsx:58, PropertyList.tsx | Currently a single generic `styles.statusBadge` span, not the mockup's `badge badge-{status}` variant classes already defined in design-system.css. |
| Verified badge next to status | contact-record.html:64 | todo | — | Not rendered at all today (email-verified is shown only in a property row, not the identity header). |
| LinkedIn outline-badge link | contact-record.html:64 | todo | — | Not rendered; no LinkedIn profile URL field surfaced in identity header. Need to check whether `person` has a LinkedIn URL column. |

## Left pane — quick actions

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Nota qa button | contact-record.html:67 | done (functional; markup differs) | QuickActions.tsx:114-116 | Wired to `addContactNoteAction`. Needs `.qa`/`.qa-icon` classes + SVG icon instead of plain text button. |
| Correo qa button | contact-record.html:68 | done (functional; markup differs) | QuickActions.tsx:117-119 | Wired to `sendContactEmailAction` + Gmail; needs icon markup. |
| Tarea qa button | contact-record.html:69 | done (functional; markup differs) | QuickActions.tsx:120-122 | Wired to `addContactTaskAction`; needs icon markup. |
| Reunión qa button | contact-record.html:70 | done (functional; markup differs) | QuickActions.tsx:123-125 | Wired to `logContactMeetingAction`; needs icon markup. |
| Descartar qa button (danger) | contact-record.html:71 | done (functional; markup differs) | QuickActions.tsx:126-128 | Wired to `discardContactAction`; needs `.qa.danger` + icon markup. |
| "Pegar señal" — NOT in this mockup's 5 quick actions | contact-record.html:66-72 (only 5: Nota/Correo/Tarea/Reunión/Descartar) | deviation (extra feature, keep) | QuickActions.tsx:129-131 | Current code has a 6th "signal" quick action absent from this mockup (it exists in `/leads`/`/contact` legacy pages per its own comment). Not a mockup regression — flag as an intentional superset, not a gap. Grid will need to stay 6-wide or wrap, not the mockup's fixed 5-column grid; needs an owner/UX call on whether to keep it in the quick-actions row or move it elsewhere. |
| "Generar mensaje con IA" secondary block button | contact-record.html:73 | todo | — | Today "Generar mensaje" is only reachable by opening the Correo composer (`GenerateMessageButton` inside `EmailForm`), not as its own standalone `.btn.btn-secondary.btn-block` entry point / dedicated wide dialog with channel+language selects and a "Señales utilizadas" chip row. Needs its own dialog. |
| "Sobre este contacto" section title + "Historial" ghost button | contact-record.html:74 | partial | AboutPane.tsx:70 (title only) | Title exists; "Historial" action (property-change history) link/button is missing entirely. |

## Left pane — property list ("Sobre este contacto")

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Estado (derived) row + badge | contact-record.html:76 | partial | PropertyList.tsx (owner row only; status not in `properties` list) | Status is rendered once in the identity header only; the mockup ALSO shows it as the first `.prop.derived` row in the property list. |
| Estado "why" derivation reason line | contact-record.html:77 | todo | — | Not implemented. Needs a `deriveStatus`-sourced human-readable reason string ("Respondió porque…", referencing the specific activity/conversation that caused the derived status) — check `src/lib/status/deriveStatus.ts` for whether it already returns a reason, or only the status value. |
| Responsable row (owner chip w/ avatar) | contact-record.html:78 | done (functional; markup differs) | PropertyList.tsx:62-133 | Editable, locked-when-connected logic present; needs `.owner-chip` + avatar markup instead of plain text. |
| Responsable "hint" (oldest connection date) | contact-record.html:78 | todo | — | Not shown; needs the oldest `person_bd_connection.connectedOn` date, distinct from `ownerLockedNote`. |
| Correo electrónico row + Verified badge + edit | contact-record.html:79 | partial | PropertyList.tsx (email is in `properties`) | Editable value present; verified badge + "Hunter · 96% confianza · actualizado por X, fecha" hint line not rendered — need `hunter_lookup`-sourced metadata (score/confidence) surfaced here, not just in the timeline. |
| Cargo row + hint ("merge kept the most specific value") | contact-record.html:80 | done (functional; markup differs) | PropertyList.tsx, page.tsx:74-76 (`lastUpdatedLabel`) | Hint exists as generic "last updated by X · date"; mockup's specific merge-provenance phrasing not present — acceptable as same-intent hint, flag as minor copy gap. |
| Grupo de rol row | contact-record.html:81 | done (functional; markup differs) | PropertyList.tsx (via `properties` if `roleGroup` is in the allow-list) | Verify `EditablePersonProperty` includes `roleGroup`; if not, todo. |
| Nivel row | contact-record.html:82 | todo? | — | Verify `EditablePersonProperty`/`record.properties` includes a `seniority`/"Nivel" field; not confirmed present. |
| Ubicación row | contact-record.html:83 | done (functional; markup differs) | PropertyList.tsx | Assumed present via `properties`; confirm `location` is in the allow-list. |
| Industria row | contact-record.html:84 | todo? | — | Verify an `industry` field exists on `person`/`properties`; not confirmed present today. |
| Origen row (LinkedIn (N BDs) · Lista de leads X) | contact-record.html:85 | todo | — | Not implemented — needs a computed "source" summary (count of distinct BD connections sourced via LinkedIn + originating lead-list name, if any) from ingestion/identity data. |
| Creado row ("6 oct 2026 · unificado por migración") | contact-record.html:86 | todo | — | Not implemented — needs `person.createdAt` + a flag/string for whether the record was created via migration/merge. |

## Center — tabs

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Actividad / Resumen tabs | contact-record.html:89-91 | done (functional; markup differs) | RecordTabs.tsx | Tab/tabpanel wiring is solid (a11y-correct); needs `.tabs`/`.tab` design-system classes instead of `page.module.css`. |

## Center — Actividad tab: filter toolbar

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| "Todo N" pill (active by default) | contact-record.html:95 | done (functional; markup differs) | Timeline.tsx:82-87 | Uses plain `<Link>` styled via page.module.css, not `.filter-pill`/`.filter-pill.on`. |
| Notas/Correos/LinkedIn/Reuniones/Tareas/Sistema pills w/ icon + count | contact-record.html:96-101 | partial | Timeline.tsx:88-96, `TIMELINE_ACTIVITY_TYPES` | Filter types exist but the mockup's exact taxonomy is 6 types (Notas/Correos/LinkedIn/Reuniones/Tareas/Sistema) whereas code's `TimelineActivityType` union is `note/email_sent/hunter_lookup/status_change/meeting_logged/discarded/status_backfill` (7, different grouping — e.g. no explicit "LinkedIn" activity type, no "Tareas" activity type in the union at all). Needs a mapping/grouping pass, not just a rename — verify what emits LinkedIn-message and task-related activity rows today. |
| No-icon pills currently (icons missing) | contact-record.html:96-101 | todo | Timeline.tsx | Pills render label + count only, no SVG icon per type. |
| "Más recientes primero" sort toggle button | contact-record.html:102 | todo | — | Not implemented; timeline has no sort control today (implicitly one order only). |

## Center — Actividad tab: composer

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Inline "Agregar una nota" composer pinned above the timeline | contact-record.html:104-105 | todo | QuickActions.tsx `NoteForm` (opened via quick action toggle, not inline-pinned) | Mockup shows the note composer permanently visible above the timeline (`id="log-note"`, `#log-note` deep link target), not behind a toggle. Current `NoteForm` only renders when "Nota" quick action is clicked. Needs to always render inline in the Actividad tab, PLUS keep working from the `#log-note` quick-action shortcut. |
| "Agregar tarea de seguimiento" ghost button inside composer bar | contact-record.html:105 | todo | — | Not implemented — the mockup's note composer has an inline follow-up-task toggle in its own action bar; current `NoteForm` has no such control. |

## Center — Actividad tab: timeline groups + items

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Date-bucketed groups ("Próximas", "Octubre 2026", "Antes de la migración") | contact-record.html:107,114,141 | todo | Timeline.tsx:99-115 (flat list, no grouping) | Needs a grouping pass: future-dated task entries first under "Próximas", then calendar-month buckets, with a distinct "pre-migration" bucket for backfilled/original-source dates. |
| Upcoming task card w/ due badge + "Marcar como hecha"/"Reprogramar" | contact-record.html:109-111 | todo | Timeline.tsx (task entries not specially rendered; no action buttons in timeline) | Timeline currently only renders read-only entries; task completion/reschedule actions exist elsewhere (right panel checkbox) but not as timeline-card buttons. |
| Email thread card (subject, message-count badge, body summary, full thread) | contact-record.html:116-123 | partial | Timeline.tsx `entryBody` (email_sent → one-line "sent to X", no thread rendering) | Current model is one activity row per email sent; mockup groups a whole thread (3 messages back and forth) into one card with a `.thread`/`.thread-msg` list. Needs data-model check: does `activity` have a thread/conversation grouping key for `email_sent` rows, or is each send/reply a separate un-grouped row today? |
| LinkedIn reply card w/ `.locked` privacy notice (BD view) | contact-record.html:124-127 | partial | Timeline.tsx `entry.visible` (generic `timelineLockedContent` string, no icon/box) | Visibility gating exists (`isTimelineEntryVisible`/R6) but rendered as plain text, not the `.locked` icon+box the mockup uses, and doesn't name whose conversation it is. |
| LinkedIn sent-message card (BD view, locked) | contact-record.html:128-131 | same as above | Timeline.tsx | Same gap. |
| Note card w/ blockquote body | contact-record.html:132-134 | done (functional; markup differs) | Timeline.tsx `entryBody` "note" case | Renders the raw note text; mockup wraps it in a `<blockquote>` inside `.tl-body`. |
| System "Unificado a partir de N registros" card (merge description) | contact-record.html:135-138 | todo | Timeline.tsx (no `merge`/`unify` activity type in the union at all) | No corresponding `TimelineActivityType` exists for migration/merge events today — needs confirming whether this is stored as `activity` rows or must be derived from `person.mergedFrom*`/identity-resolution tables. |
| Pre-migration "Correo encontrado · Hunter" card | contact-record.html:143-145 | done (functional; markup differs) | Timeline.tsx `entryBody` "hunter_lookup" case | Present, needs blockquote-free `.tl-body` styling only (already close). |
| Pre-migration "Estado registrado antes de la migración" system card | contact-record.html:146-148 | done (functional; markup differs) | Timeline.tsx `entryBody` "status_backfill" case | **This is the one with the known `metadata.originalAt` timing rule** — confirmed handled correctly already at the query layer (see `src/lib/activity/queries.ts` / `src/lib/status/deriveStatus.ts`); only markup/grouping is outstanding, not the time-source bug class. |

## Center — Resumen tab

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| "Resumen" placeholder | contact-record.html:151-157 | todo | page.tsx:118 (`{l.overviewComingSoon}` placeholder div) | Entirely unimplemented: two `.stat` cards (Última actividad / Puntos de contacto), "Tareas abiertas" card, "Señales" card (hiring-signal summary). All need real data — last-activity age + channel breakdown, all-BD touchpoint count/breakdown, open-task list, company hiring signal text (reuse `getHiringMatchIndex`, same as `/contacts`). |

## Right pane — Empresa card

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Company card w/ logo-initial chip, name link, domain · industry | contact-record.html:160-161 | partial | page.tsx:126-134 | Only renders a bare company name/link today; no `.company-logo.lg` chip, no domain/industry sub-line — need to confirm `person`/`company` table exposes domain + industry for this record (companies list/company-record page may already have this query — reuse it, don't reinvent). |
| "Cambiar empresa" ghost icon-button | contact-record.html:160 | todo | — | Not implemented; no company-reassignment action exists on this page today. |
| "Contratando · N puestos de IT" + "Etapa: X" badges | contact-record.html:162 | todo | — | Needs the same `getHiringMatchIndex()` hiring lookup `/contacts` already uses (reuse, no new query), plus a company "stage" field if one exists. |
| "N contactos en esta empresa" meta line | contact-record.html:163 | todo | — | Needs a count query scoped to `person.companyKey`. |

## Right pane — BDs conectados card

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Card header "BDs conectados" + count | contact-record.html:165 | todo (markup) | page.tsx:135-165 (data present, no card header count) | Data (`record.connections`) already renders; needs `<span class="meta">{count}</span>` in the header. |
| Per-BD avatar + name + "Responsable" badge (for owner) | contact-record.html:167 | partial | page.tsx:142-144 | Name shown as plain text, no avatar, no "Responsable" badge distinguishing the owner row from the rest — need to compare `c.bdId === record.person.ownerBdId`. |
| "Conectado el {date}" sub-line | contact-record.html:167-169 | done (functional; markup differs) | page.tsx:145 (`connectedOnPrefix`) | Present; just needs markup rework to `.assoc-row`/`.s`. |

## Right pane — Historial de conversaciones card

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Card exists as its own titled section, listing every BD with conversation history + message count + last-message date | contact-record.html:172-178 | todo | page.tsx (folded into the "BDs conectados" card as a single `assocMeta` line + link, not its own card) | Mockup separates "BDs conectados" (all connections) from "Historial de conversaciones" (only BDs who actually have message history) as two distinct cards. Current code conflates them into one card. `describeConnectionHistory` already computes count/lastMessageAt (`connectionHistory.ts`) — reuse it, just re-split the markup into two cards. |
| Per-conversation "Ver" button (admin) → `/contacts/[id]/conversation/[bdId]` | contact-record-admin.html:182-183 | done (functional; markup differs) | page.tsx:154-157 (`viewConversationLink`) | Link exists and is admin+has-history gated correctly; needs `.btn.btn-secondary.btn-sm` markup with icon, not plain text link. |
| "El contenido es privado para cada BD" footer note (BD view) | contact-record.html:177 | todo | — | Not rendered. |
| "Los administradores pueden abrir cualquier conversación…" footer note (admin view) | contact-record-admin.html:184 | todo | — | Not rendered. |

## Right pane — Tareas card

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Card w/ "+" add-task icon-button in header | contact-record.html:180 | todo | — | Not implemented as its own right-panel card; task creation only reachable via the left "Tarea" quick action. |
| Task row w/ checkbox + title + "Vence X · Asignado" | contact-record.html:181 | todo | — | No open-tasks-for-this-person listing surfaced anywhere on the page today (confirm whether a `tasks` table/query already exists — likely reusable from `/tasks`). |
| Checkbox "complete task" affordance | contact-record.html:181 | todo | — | Needs a real "mark task done" server action if the tasks feature exists elsewhere in the codebase; else flag as a cross-page dependency. |

## Admin-only additions (contact-record-admin.html only)

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| Admin sidenav section (Duplicados/Migración) | contact-record-admin.html:26-29 | out of scope | shell (ported elsewhere) | Shared shell chrome, not specific to this page. |
| Inline-expanded LinkedIn conversation (admin sees full thread directly in the main timeline, not just "exists") | contact-record-admin.html:128-134 | todo | conversation/[bdId]/page.tsx (exists ONLY as a separate subpage, not inline in the timeline) | Mockup's admin timeline shows the full Juan Martínez thread directly inline in the Actividad tab (with an `.alert.alert-audit` banner above it), not as a link-out to a separate page. Current implementation always sends admin to the dedicated `/conversation/[bdId]` subpage. **This is a real markup/flow deviation worth flagging to the owner**: keep the separate-page pattern (simpler, already audited, already tested) vs. inline-expand within the timeline (matches mockup exactly but is a bigger rework touching Timeline.tsx's rendering model). Recommend keeping the separate-page pattern unless the owner insists on inline. |
| `.alert.alert-audit` banner ("Está viendo la conversación de otro BD… quedó registrada…") | contact-record-admin.html:130 | todo | conversation/[bdId]/page.tsx:66-68 (`auditNotice`, plain `<p>`) | Notice text exists but not as the mockup's alert-box markup; also mockup's banner is inline in the timeline card, current one is a page-level banner on the separate subpage — same deviation as above. |
| "Ver conversación (queda registrada en auditoría)" secondary button on other LinkedIn-conversation entries | contact-record-admin.html:135-138 | n/a (folded into the associations panel link today) | page.tsx `viewConversationLink` | Only one entry point to the audited view exists (right panel), not a per-timeline-entry button; consistent with the "separate page" pattern above. |
| "Revisar / deshacer fusión" secondary button on the merge/system timeline card | contact-record-admin.html:145 | todo | — | Depends on the "Unificado a partir de N registros" timeline card existing at all (see above) — needs a link to `duplicates.html#history` equivalent (`/admin/duplicates`?), gated to admin. |
| Per-conversation "Ver" button replacing the BD-view's plain history row | contact-record-admin.html:182-183 | done (functional; markup differs) | page.tsx:154-157 | Same gate/link as noted above (already correct logic, `canViewConversation`). |
| Toast "Visualización de conversación registrada en el registro de auditoría" on returning from an audited view | contact-record-admin.html:226 | todo | — | Not implemented — no toast fires today when an admin returns from the audited subpage; the audit_log write itself already happens server-side in `getConversationForAdmin`. |

## Dialogs (shared by both mockups)

| element | mockup ref | status | evidence file:line | notes |
|---|---|---|---|---|
| "Generar mensaje" wide dialog (canal/idioma selects, "Señales utilizadas" chips, draft textarea, Regenerar/Copiar/"Usar en correo") | contact-record.html:186-196 | todo | QuickActions.tsx `EmailForm`'s embedded `GenerateMessageButton` (no channel/language selects, no signal chips, no standalone dialog — generation happens inline inside the email composer only) | Needs its own dialog component, reachable from the left pane's "Generar mensaje con IA" button (see above), independent of the email composer. Channel select (LinkedIn message vs Email) implies the generated draft can also target a LinkedIn-message send path — confirm whether that path exists server-side or is BD-copy-only (mockup's own copy says "no se registra nada hasta que se envíe o copie", i.e. Copiar is a valid terminal action, not just a stepping stone to email). |
| "Registrar reunión" dialog | contact-record.html:197-202 | done | QuickActions.tsx `MeetingForm` | Fields, help text, and submit action all match. Needs class parity check against `.dialog`/`.form-grid` (uses shared `Dialog` component — verify it renders those classes already). |
| "Descartar contacto" dialog (reason select w/ invalid state, required note for "Otro") | contact-record.html:203-207 | done | QuickActions.tsx `DiscardForm` | Reason codes match `DISCARD_REASON_CODES`; "Otro" → required note logic present (`requiresNote`). Mockup's disabled-until-valid submit button and `is-invalid` select style should be double-checked once ported to design-system classes. |
| "Crear tarea" dialog | contact-record.html:208-212 | done | QuickActions.tsx `TaskForm` | Title/due-date/assignee fields — confirm "Asignado a" select (assignee choice) exists; current `TaskForm` only has title + date, no assignee picker. **Gap**: no assignee select today. |
| "Enviar correo" wide dialog (Para/Asunto/Mensaje + "Redactar con IA" left-aligned link + Enviar) | contact-record.html:213-219 | done (functional; markup close) | QuickActions.tsx `EmailForm` | Matches closely already (this is the one composer already fairly aligned); "Redactar con IA" is the existing `GenerateMessageButton`, help text about Gmail send + status-effect present via `l.emailToLabel`-adjacent copy — confirm exact help copy matches mockup's "Se registra como... Contactado" sentence. |

## Summary counts (this audit)

- done (functional, markup or minor copy differences only): ~24
- partial (some but not all sub-elements present): ~9
- todo (missing entirely or requires new data/queries): ~33
- deviation (intentional superset, needs owner confirmation): 1 (signal quick action)
- flagged for owner decision: inline-expand vs. separate-page admin conversation view (2 rows)

Everything server-action-preserving: no existing action's signature or
behavior is to change during markup work; only new reads/markup are added.
