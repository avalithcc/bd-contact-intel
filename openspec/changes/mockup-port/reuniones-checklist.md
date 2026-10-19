# Reuniones (meeting-outcomes) mockup-port checklist

Mockup: `openspec/changes/meeting-outcomes/mockups/reuniones.html` (+ `crm-hubspot-ux/mockups/styles.css`).
Columns: `element | mockup ref | status | evidence file:line | notes`.

Verified in a browser (Playwright against a local scratch rig: local Supabase Auth, scratch database) as a BD and as an admin:
the page, the dialog with all four outcomes, undo, scheduling from the record, the strip, the timeline cards, no horizontal
scroll at 1024px, keyboard open/close with focus return.

## 1. Registrar reunión (dialog on the contact record)

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Dialog title "Registrar reunión" with calendar icon and close button | s1 `#m1-title` | done | src/app/(app)/contacts/[id]/QuickActions.tsx:775-777, src/components/Dialog.tsx (new optional `icon`) | shared Dialog keeps its "×" glyph |
| Fecha + Hora fields (`form-grid`), time zone Argentina | s1 `#m1-date`/`#m1-time` | done | QuickActions.tsx:795-822, src/lib/meetings/outcome.ts (planMeetingEntry) | wall clock read as Argentina time |
| Blue info alert "Se guardará como agendada…" when date+time is in the future | s1 `.alert-info` | done | QuickActions.tsx:828-831 | same exact comparison as the server |
| Help "Al guardar, el estado derivado pasa a Reunión." when past | s1 `.help` | done | QuickActions.tsx:833 | |
| Notas textarea | s1 `#m1-notes` | done | QuickActions.tsx:835-845 | |
| Footer: Cancelar + primary "Agendar reunión" (future) / "Registrar reunión" (past) | s1 footer | done | QuickActions.tsx:789 | |
| Future date saved as Agendada (server), past saved as Realizada as today | s1 notes | done | src/lib/meetings/db.ts (registerContactMeeting), src/app/(app)/contacts/actions.ts (logContactMeetingAction), tests/db/meetings.test.ts | toast "Reunión agendada." vs "Reunión registrada." |
| Error "No se puede registrar una reunión con fecha futura" removed for contacts | s1 note 3 | done | src/app/(app)/contacts/actions.ts (no planMeeting call) | the company-level action keeps its guard on purpose (no scheduling there) |

## 2. Contact record

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| "Reunión agendada · jue 22 oct, 15:00" strip under identity with notes line | s2 `.upnext` | done | src/app/(app)/contacts/[id]/UpcomingMeetings.tsx:67-85, AboutPane.tsx:155 | only the nearest; only when one exists |
| Strip buttons Reprogramar / Cancelar (open outcome dialog preselected) | s2 `.upnext` | done | UpcomingMeetings.tsx:30-62 | plus Confirmar once the time has passed (addition, see deviations) |
| Timeline group "Próximas" with dashed card, badge Agendada, "Agendada por <BD>" | s2 `.tl-card.upcoming` | done | UpcomingMeetings.tsx:87-110, Timeline.tsx:1309-1316 | |
| Próximas card actions Reprogramar / Cancelar | s2 `.tl-actions` | done | UpcomingMeetings.tsx:105 | |
| Held meeting card "Reunión registrada" + badge Realizada | s2 | done | src/app/(app)/contacts/[id]/MeetingTimelineCard.tsx:41-48 | |
| Rescheduled card struck through, badge Reprogramada, "Reprogramada → nueva fecha" | s2 `.tl-card.moved` | done | MeetingTimelineCard.tsx:49-55 | |
| No-show card "Reunión: no se presentó" | s5c | done | MeetingTimelineCard.tsx:56-61 | reason shown when given |
| Cancelled card "Reunión cancelada" | s5c | done | MeetingTimelineCard.tsx:62-67 | |
| Pill "Reuniones" filter includes the new meeting entries | existing pills | done | src/lib/activity/timelinePills.ts (meeting_logged group), src/lib/activity/queries.ts (TIMELINE_ACTIVITY_TYPES) | `meeting_scheduled` is audit-only, not a timeline type |
| Read-only for meetings of other BDs (admin sees them without buttons) | s3c note | done | src/lib/meetings/queries.ts (getScheduledMeetingsForPerson `canMutate`), UpcomingMeetings.tsx:48 | a BD sees only their own scheduled meetings of the contact |
| Company record timeline names the new activity types | n/a (regression guard) | done | src/lib/companies/timelineView.ts, tests/unit/companyTimelineView.test.ts | raw type names would otherwise leak |

## 3. Reuniones page

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Sidebar item "Reuniones" under Espacio de trabajo with calendar icon | s3a `.mini-nav` | done | src/app/contacts/Sidebar.tsx:80 | between Seguimientos and Secuencias, as the mockup |
| Sidebar counter = own "Por confirmar" | s3a | done | src/lib/shell/appShellBadgeCountsQuery.ts:207-216, Sidebar.tsx:203 | one more scalar in the existing shell statement |
| Page header: eyebrow, `reuniones.` title, subtitle | s3a `.page-header` | done | src/app/(app)/reuniones/page.tsx:67-77 | |
| View tabs with counts, six in mockup order | s3a `.view-tabs` | done | page.tsx:82-89, src/lib/meetings/view.ts (meetingViewTabs) | |
| Default tab: Por confirmar if any else Agendadas | s3a note | done | src/lib/meetings/queries.ts (eff CTE), tests/db/meetingsPage.test.ts | decided in the same statement |
| Empty tab text "No tienes reuniones en este estado." | s3a note | done | MeetingsList.tsx:62-70 | admin variant says "No hay reuniones…" (see deviations) |
| Table columns Contacto (avatar+link), Empresa, Fecha y hora, Estado, Notas, Acciones | s3a | done | src/app/(app)/reuniones/MeetingsList.tsx:75-85,96-118 | |
| Date cell "hoy 11:00 · hace 7 h" / "ayer 10:00" / "jue 22 oct, 15:00" | s3a | done | MeetingsList.tsx:112-115, src/lib/meetings/when.ts | |
| Badges: Por confirmar, Agendada, Realizada, No se presentó, Reprogramada, Cancelada | s3a/s5c | done | src/lib/meetings/labels.ts (meetingStatusBadgeClass) | |
| Por confirmar rows: one primary "Confirmar", whole row clickable | s3a | done | MeetingsList.tsx:88-96,121-127 | link and buttons keep their own click |
| Agendadas rows: Reprogramar (secondary) + Cancelar (ghost) | s3b | done | MeetingsList.tsx:128-136 | |
| Other tabs: Acciones column empty | s3b note | done | MeetingsList.tsx (only pending/scheduled render buttons) | |
| Footnote "Las filas son de solo lectura…" | s3a `.meta` | done | page.tsx:98 | Por confirmar tab only |
| Admin: BD column with owner chip | s3c | done | MeetingsList.tsx:104-111 | |
| Admin: toolbar BD select (Todos + each BD), Desde, Hasta (default current month) | s3c | done | src/app/(app)/reuniones/MeetingFilters.tsx, view.ts (resolveMeetingScope) | applies on change, no button (mockup has none) |
| Admin: badge "Solo administradores ven a todos los BD" | s3c | done | MeetingFilters.tsx:62 | |
| Admin: read-only on other BDs' meetings (no buttons) | s3c note | done | queries.ts (`canMutate`), outcome.ts (planOutcome/planUndo ownership), tests/db/meetings.test.ts | enforced in the write, not only hidden |
| Tab counts follow active filters | s3c note | done | queries.ts (counts use the same scope), tests/db/meetingsPage.test.ts | |
| Loading skeleton (`loading.tsx`) | design rule | done | src/app/(app)/reuniones/loading.tsx | |

## 4. Outcome dialog

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Title "¿Cómo fue la reunión con <nombre>?" / "Reprogramar la reunión con…" / "Cancelar la reunión con…" | s3d/s3f | done | src/components/meetings/OutcomeDialog.tsx:79-83 | |
| Summary (Contacto, Empresa, Agendada para, Notas) | s3d `.summary` | done | OutcomeDialog.tsx:150-168 | |
| Four radio cards with descriptions | s3d `.opts` | done | OutcomeDialog.tsx:169-199 | card is a div with the radio's own label (repo rule: no label wrapping a control in a Dialog) |
| Guardar disabled until an option (and its required fields) is chosen; "Elige un resultado para continuar." | s3d | done | OutcomeDialog.tsx:70-78,201 | |
| Se hizo: "¿Qué se habló? (opcional)" textarea | s3d | done | OutcomeDialog.tsx:203-211 | |
| Reprogramada: Nueva fecha + Hora (required, future), help text | s3d | done | OutcomeDialog.tsx:213-232 | past value shows a warning and keeps Guardar disabled |
| No se presentó / Cancelada: Motivo, "Crear tarea de seguimiento" checked, Vence +2 days editable | s3d | done | OutcomeDialog.tsx:234-266, outcome.ts (defaultFollowUpDueDate) | |
| Footer button names the action (Guardar / Reprogramar / Cancelar reunión) | s3d/s3f | done | OutcomeDialog.tsx:84-92 | |
| Se hizo / No se presentó disabled with "Disponible cuando pase la hora de la reunión" before the time | s3f note | done | OutcomeDialog.tsx:173-193, outcome.ts (availableOutcomes) | also refused by the server |
| Preselected option from Reprogramar / Cancelar | s3f | done | OutcomeDialog.tsx:29,60 (PRESELECTED) | |
| Close with X, Escape, Cancelar saves nothing; failure keeps dialog open with error; success closes and returns focus | s3d note | done | OutcomeDialog.tsx:96-125, shared Dialog | focus return verified in the browser |
| Toast "Reunión confirmada" + "Deshacer" | s3e | done | OutcomeDialog.tsx:112-124 | |
| Undo restores previous state | s3e | done | src/lib/meetings/db.ts (undoMeetingOutcome), outcome.ts (undo rule in the file header), tests/db/meetings.test.ts | window 5 min; removes the activity, the reschedule's untouched new meeting and an untouched auto-created task |

## 5. Email 18:00

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| From notificaciones@crm.avalith.net via the existing mailer | s4 | done | src/app/api/meetings/digest/route.ts (sendDigestEmail) | |
| Subject "Tienes N reuniones de hoy sin confirmar" | s4 | done | src/lib/meetings/digest.ts, tests/unit/meetingDigest.test.ts | singular for 1 |
| Greeting + list of today's unconfirmed meetings (avatar initials, name, company, time) | s4 | done | digest.ts (rowsHtml) | |
| Button "Confirmar reuniones" to /reuniones (Por confirmar tab) | s4 | done | digest.ts (`/reuniones?view=pending`) | |
| Line "También tienes N reunión(es) de días anteriores en la cola." | s4 | done | digest.ts | |
| Footer reason line | s4 | done | digest.ts (l.emailReason) | |
| One per BD per day, only if today has an unconfirmed meeting | s4 notes | done | src/lib/meetings/digestQueries.ts (claimMeetingDigest), tests/db/meetingDigest.test.ts | claim row unique (bd, Argentina date), claimed before sending |
| Cron route protected by bearer + pg_cron SQL 21:00 UTC (not applied) | owner decision | done | src/app/api/meetings/digest/route.ts, src/lib/auth/sessionExemptRoutes.ts, scripts/meetings-digest-cron.sql | `?dryRun=1` supported |

## 6. State and reports semantics

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Only "Se hizo" moves the contact to Reunión | s5a/s5c | done | src/lib/status/deriveStatus.ts (STATUS_NEUTRAL_ACTIVITY_TYPES), tests/db/meetings.test.ts, tests/unit/meetingOutcome.test.ts | |
| Existing meeting_logged rows stay Realizada (copied as held meetings) | s6 | done | drizzle/0054_meeting_outcomes.sql (backfill), tests/db/meetings.test.ts | activity rows untouched |
| Every outcome change logged as activity with the actor | owner decision | done | src/lib/meetings/db.ts (createActivityInTx with actorBdId) | an undo deletes the activity it took back |
| Reports untouched; requirements handed to the orchestrator | owner decision | done | (report) | |

## Deviations and additions the owner may want to decide

| item | status | notes |
| --- | --- | --- |
| Confirmar button on the record strip and Próximas card for a meeting whose time has passed | deviation (addition) | the mockup shows only Reprogramar/Cancelar there; without it a pending meeting would be confirmable only from /reuniones. Badge reads "Por confirmar". |
| Admin empty-tab text "No hay reuniones en este estado para este filtro." | deviation | the mockup text says "No tienes…", wrong for a team-wide view |
| Sidebar order: Reuniones between Seguimientos and Secuencias | deviation from an older test | tests/unit/sequencesInert.test.ts asserted Secuencias directly below Seguimientos; the approved mockup puts Reuniones between, so the test was updated |
| Undo deletes the activity (and an untouched new meeting/task) instead of logging a reversal | decision | keeps timelines clean and a cancelled "Se hizo" stops counting; the actor is the same BD within 5 minutes |
| Outcome timeline cards show the actor next to the date | addition | attribution rule; the mockup shows only the date |
| Date shown with weekday only on Por confirmar/Agendadas tabs | decision | follows the mockup (history rows show "18 oct, 10:00") |
