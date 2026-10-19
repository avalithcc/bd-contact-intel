# Reuniones (meeting-outcomes) mockup-port checklist

Mockup: `openspec/changes/meeting-outcomes/mockups/reuniones.html` (+ `crm-hubspot-ux/mockups/styles.css`).
Columns: `element | mockup ref | status | evidence file:line | notes`.

## 1. Registrar reunión (dialog on the contact record)

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Dialog title "Registrar reunión" with calendar icon and close button | s1 `#m1-title` | todo | | |
| Fecha + Hora fields (`form-grid`), time zone Argentina | s1 `#m1-date`/`#m1-time` | todo | | |
| Blue info alert "Se guardará como agendada…" when date+time is in the future | s1 `.alert-info` | todo | | exact date+time comparison |
| Help "Al guardar, el estado derivado pasa a Reunión." when past | s1 `.help` | todo | | |
| Notas textarea | s1 `#m1-notes` | todo | | |
| Footer: Cancelar + primary button "Agendar reunión" (future) / "Registrar reunión" (past) | s1 footer | todo | | |
| Future date saved as Agendada (server), past saved as Realizada as today | s1 notes | todo | | |
| Error "No se puede registrar una reunión con fecha futura" removed for contacts | s1 note 3 | todo | | company-level action keeps its guard |

## 2. Contact record

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| "Reunión agendada · jue 22 oct, 15:00" strip under identity with notes line | s2 `.upnext` | todo | | only when an upcoming meeting exists |
| Strip buttons Reprogramar / Cancelar (open outcome dialog preselected) | s2 `.upnext` | todo | | |
| Timeline group "Próximas" with dashed card, badge Agendada, "Agendada por <BD>" | s2 `.tl-card.upcoming` | todo | | |
| Próximas card actions Reprogramar / Cancelar | s2 `.tl-actions` | todo | | |
| Held meeting card "Reunión registrada" + badge Realizada | s2 | todo | | |
| Rescheduled card struck through, badge Reprogramada, "Reprogramada → nueva fecha" | s2 `.tl-card.moved` | todo | | |
| No-show card "Reunión: no se presentó" | s5c | todo | | |
| Cancelled card "Reunión cancelada" | s5c | todo | | |
| Pill "Reuniones" filter includes the new meeting entries | existing pills | todo | | |
| Read-only for meetings of other BDs (admin sees them without buttons) | s3c note | todo | | |

## 3. Reuniones page

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Sidebar item "Reuniones" under Espacio de trabajo with calendar icon | s3a `.mini-nav` | todo | | |
| Sidebar counter = own "Por confirmar" | s3a | todo | | one more scalar in the shell badge statement |
| Page header: eyebrow, `reuniones.` title, subtitle "Tus reuniones agendadas y su resultado." | s3a `.page-header` | todo | | |
| View tabs with counts: Por confirmar, Agendadas, Realizadas, No se presentó, Reprogramadas, Canceladas | s3a `.view-tabs` | todo | | |
| Default tab: Por confirmar if any else Agendadas | s3a note | todo | | |
| Empty tab text "No tienes reuniones en este estado." | s3a note | todo | | |
| Table columns Contacto (avatar+link), Empresa, Fecha y hora, Estado, Notas (truncated), Acciones | s3a | todo | | |
| Date cell "hoy 11:00 · hace 7 h" / "ayer 10:00" / "jue 22 oct, 15:00" | s3a | todo | | |
| Badge states: Por confirmar (warn), Agendada (meeting), Realizada (success), No se presentó (warn), Reprogramada (neutral), Cancelada (danger) | s3a/s5c | todo | | |
| Por confirmar rows: one primary "Confirmar" button, whole row clickable | s3a | todo | | contact link stays a separate link |
| Agendadas rows: Reprogramar (secondary) + Cancelar (ghost) | s3b | todo | | |
| Other tabs: Acciones column empty | s3b note | todo | | |
| Footnote "Las filas son de solo lectura…" | s3a `.meta` | todo | | |
| Admin: BD column with owner chip | s3c | todo | | |
| Admin: toolbar BD select (Todos + each BD), Desde, Hasta (default current month) | s3c | todo | | |
| Admin: badge "Solo administradores ven a todos los BD" | s3c | todo | | |
| Admin: read-only on other BDs' meetings (no buttons) | s3c note | todo | | server-enforced as well |
| Tab counts follow active filters | s3c note | todo | | |
| Loading skeleton (`loading.tsx`) | design rule | todo | | |

## 4. Outcome dialog

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Title "¿Cómo fue la reunión con <nombre>?" / "Reprogramar la reunión con…" / "Cancelar la reunión con…" | s3d/s3f | todo | | |
| Summary (Contacto, Empresa, Agendada para, Notas) | s3d `.summary` | todo | | |
| Four radio cards: Se hizo, No se presentó, Reprogramada, Cancelada with descriptions | s3d `.opts` | todo | | |
| Guardar disabled until an option (and its required fields) is chosen; help "Elige un resultado para continuar." | s3d | todo | | |
| Se hizo: "¿Qué se habló? (opcional)" textarea | s3d | todo | | |
| Reprogramada: Nueva fecha + Hora (required), help text | s3d | todo | | |
| No se presentó / Cancelada: Motivo (optional), checkbox "Crear tarea de seguimiento" checked, Vence date +2 days editable | s3d | todo | | |
| Footer Guardar / Reprogramar / Cancelar reunión depending on entry point | s3d/s3f | todo | | |
| Se hizo / No se presentó disabled with "Disponible cuando pase la hora de la reunión" before the time | s3f note | todo | | |
| Preselected option from Reprogramar / Cancelar | s3f | todo | | |
| Close with X, Escape, Cancelar saves nothing; failure keeps dialog open with error; success closes and returns focus | s3d note | todo | | shared Dialog |
| Toast "Reunión confirmada" + "Deshacer" | s3e | todo | | |
| Undo restores previous state | s3e | todo | | rule documented in `src/lib/meetings/outcome.ts` |

## 5. Email 18:00

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| From notificaciones@crm.avalith.net via the existing mailer | s4 | todo | | |
| Subject "Tienes N reuniones de hoy sin confirmar" | s4 | todo | | |
| Greeting + list of today's unconfirmed meetings (avatar, name, company, time) | s4 | todo | | |
| Button "Confirmar reuniones" to /reuniones | s4 | todo | | |
| Line "También tienes N reunión(es) de días anteriores en la cola." | s4 | todo | | |
| Footer reason line | s4 | todo | | |
| One per BD per day, only if today has an unconfirmed meeting | s4 notes | todo | | claim row unique (bd, date) |
| Cron route protected by bearer + pg_cron SQL 21:00 UTC (not applied) | owner decision | todo | | |

## 6. State and reports semantics

| element | mockup ref | status | evidence file:line | notes |
| --- | --- | --- | --- | --- |
| Only "Se hizo" moves the contact to Reunión | s5a/s5c | todo | | |
| Existing meeting_logged rows stay Realizada (backfilled as held meetings) | s6 | todo | | |
| Every outcome change logged as activity with the actor | owner decision | todo | | |
| Reports untouched; requirements handed to the orchestrator | owner decision | todo | | |
