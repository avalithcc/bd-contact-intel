# send-now-or-schedule mockup parity checklist

Source mockup: `openspec/changes/send-now-or-schedule/mockups/enviar-o-programar.html` (sections 1 to 5, margin notes included).
Owner rules that override parts of the mockup (2026-10-19, final): an explicit choice ("Enviar ahora", a chosen time) is respected
even before 09:00 Miami; the Miami floor applies to the cadence option (and to reminders) only; there are no disabled hours in any
popover; instead a non-blocking disclaimer when the recipient's local time (Miami for an unknown Sequence recipient, nothing for an
unknown one-off recipient) is before 09:00 or on a weekend, with a "Usar <próximo día hábil> 9:00" button.

Columns: element | mockup ref | status | evidence | notes

## 1. Split button

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Split button "Enviar ahora" + chevron, `aria-haspopup`/`aria-expanded`/`aria-label` | 1a | done | src/components/send/SendSplitButton.tsx:107-120 | `.split-btn`/`.split-chev` promoted to design-system.css |
| Menu above the footer, first item "Programar…" with "Elige día y hora" | 1a | done | src/components/send/SendSplitButton.tsx:129-139 | `.menu.up` |
| Contact composer footer uses it (Redactar con IA, Cancelar, split) | 1a | done | src/app/(app)/contacts/[id]/QuickActions.tsx:688 | replaces "Programar…" + ScheduleEmailDialog flow; dialog kept only for editing a scheduled row in /scheduled |
| Review dialog footer: "Aprobar y enviar ahora" split with "Programar…" and "Según la cadencia de la Secuencia" + hint | 1b | done | src/app/(app)/sequences/_components/ReviewDialog.tsx:81 | cadence hint "mañana 20/10 a las 9:00 (Miami)" from `cadenceHint` |
| Review dialog "Cadencia para este contacto": "Hoy sale: al aprobar, o en el momento que elijas" | 1b | done | src/app/(app)/sequences/_components/ReviewDialog.tsx:143 | |
| Draft card "Aprobar" is the split button | 1b | done | src/app/(app)/sequences/_components/MemberCard.tsx:85 | small size |
| Bulk bar "Aprobar y enviar ahora los N" split | 1c | done | src/app/(app)/sequences/_components/BulkBar.tsx:33 | disabled until every selected draft was opened (existing gate) |
| Bulk cap warning "Tope diario: 5 por cuenta … 5 salen en el próximo minuto y 2 quedan…" before confirming | 1c | done | src/app/(app)/sequences/_components/BulkBar.tsx:49 | numbers from `detail.sentToday` + `capOutlook`; wording "para el próximo envío disponible" (no fixed "mañana 9:00", the next slot depends on the cron) |
| Alternative "dos botones siempre visibles" | 1c | deviation | — | mockup asks the owner to decide; the split button (the recommended one) is built |
| Keyboard: Enter/Space opens, arrows navigate, Esc closes and returns focus to the chevron | 1 note | done | src/components/send/SendSplitButton.tsx:70-85 | Home/End not handled |
| Same component in all places | 1 | done | src/components/send/ | one SendSplitButton + one SchedulePopover |

## 2. Schedule popover

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Popover `role=dialog`, title with clock icon, opens upward (down on cards) | 2a | done | src/components/send/SchedulePopover.tsx:120-125 | titles: "Programar envío" / "Programar la aprobación" / "…de los N listos" |
| Shortcuts En 1 hora, Mañana 9:00, Lunes 9:00 (Argentina time) | 2a | done | src/components/send/SchedulePopover.tsx:130-143 | `schedulePresets` in src/lib/sendSchedule/time.ts; pressed state |
| Single-day calendar, same look/logic as the period picker, Monday first, past days disabled and struck, today underlined, 7 columns | 2 | done | src/components/calendar/CalendarMonth.tsx | PeriodPicker refactored onto the same component; `.day` resets button padding |
| Max 30 days ahead (days beyond disabled) | 2 note | done | src/components/send/SchedulePopover.tsx:62 | |
| Time field typed ("9:30", "930", "21") + 15-minute list, invalid marks the field | 2 note | done | src/components/send/SchedulePopover.tsx:160-200 | `parseTimeInput`; past/too-soon options struck and disabled |
| Limits message under the field (5 min, 30 days, past) | 2 note | done | src/components/send/SchedulePopover.tsx:175-179 | |
| Time-zone reference: Argentina bold "tu hora", recipient row, fixed Nueva York/Madrid/Ciudad de México/Bogotá/São Paulo, no repeat of the recipient's zone, "+1 día/-1 día" tag | 2a, 3a | done | src/components/send/SchedulePopover.tsx:207-225, src/lib/sendSchedule/zones.ts | "aprox." for multi-zone countries; per-country default zone + city table + short US state table |
| Recipient row badge | 2a/2b | deviation | src/components/send/SchedulePopover.tsx:121 | mockup: "fuera de 8:00 a 19:00" / "dentro de horario". Final owner rule: "antes de las 9:00 / fin de semana" / "dentro de horario"; late evening no longer warns |
| Warning "Para Lucía serán las 7:00. ¿Seguro?" + "Usar …" button | 2a | done | src/components/send/SendAdvice.tsx | text "Para {name} ({place}) serán las {clock} del {weekday}. ¿Seguro?"; button offers 9:00 recipient time of the next business day, shown in Argentina time |
| Summary "Se enviará el jue 22 oct a las 10:00 (hora de Argentina)." | 2a | done | src/components/send/SchedulePopover.tsx:229 | three wordings: email / approval / bulk |
| Footer note + Cancelar + submit ("Programar envío" / "Aprobar y programar" / "…los N") | 2a, 2c, 2d | done | src/components/send/SchedulePopover.tsx:247 | |
| 2c info alert "Las Secuencias no envían antes de las 9:00 de Miami" and disabled earlier hours | 2c | deviation | — | reversed by the owner (explicit choices respected); replaced by the disclaimer above |
| 2d "Tope diario: … 2 quedarían para el jue 22" alert inside the bulk popover for a CHOSEN time | 2d | deviation | — | only the "send now" outlook is shown (BulkBar); a chosen time's cap split is not projected |
| 2d grouped recipient rows "Destinatarios en Florida y Texas (5): 9:30 / 8:30" | 2d, 3c | done | src/lib/sendSchedule/zones.ts (`buildGroupRows`) | |
| Attachments the server cannot read back block scheduling (existing rule) | — | done | src/components/send/SchedulePopover.tsx:237 | `blockedReason` |
| Server converts the Argentina date+time (`argentinaWallClockToUtc`) and validates | 2 note | done | src/app/(app)/contacts/scheduleActions.ts:50, src/lib/sequences/sendMoment.ts | contact action now takes `{date,time}`; Sequence actions take a `SendChoice` |

## 3. Time-zone reference rules

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Recipient zone from person country/city/region, else company country | 3a | done | src/app/(app)/contacts/[id]/page.tsx (send prop), src/lib/sequences/detailQueries.ts (`place`) | no new query: columns added to existing reads |
| Unknown place: only Argentina + fixed rows | 3b | done | src/lib/sendSchedule/zones.ts `buildZoneRows` | |
| Daylight saving follows the chosen date | 3 note | done | tests/unit/sendScheduleZones.test.ts | |

## 4. After scheduling

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| "Programado" card: badge, "Programado · jue 22 oct 10:00 (Argentina) · en Tampa serán las 9:00 · aprobado por ti hace 2 min" | 4a | done | src/app/(app)/sequences/_components/MemberCard.tsx:33-45 | |
| Actions Ver correo, Cambiar (opens the popover loaded), Enviar ahora, Cancelar programación | 4a | done | src/app/(app)/sequences/_components/MemberCard.tsx:96-118 | |
| Cadence-approved card "Aprobado": "Sale mañana … (Miami) · 10:00 en Argentina" + Cambiar, Enviar ahora, Cancelar envío | 4b | done | src/app/(app)/sequences/_components/MemberCard.tsx:46-51 | cadence vs chosen derived by `approvedMoment` |
| Locked when it leaves in under 2 minutes ("Ya está por salir", all three disabled) | 4c | done | src/app/(app)/sequences/_components/MemberCard.tsx:76,106-117; src/lib/sequences/approvedMoment.ts | server also refuses (`locked`) |
| Overdue (cap or check holding it): "En espera del próximo envío disponible" | 5 note | done | src/app/(app)/sequences/_components/MemberCard.tsx:33 | |
| Contact timeline "Próximas": Sequence email card with Secuencia tag and "Abrir en la Secuencia" | 4d | done | src/app/(app)/scheduled/ScheduledCard.tsx (`SequenceStepCard`), src/app/(app)/contacts/[id]/Timeline.tsx:1321 | "Aprobado el …" without the actor's name (the read does not carry it) |
| Enviar ahora with the cap reached: confirm with a notice | 4 note | deviation | src/app/(app)/sequences/[id]/SequenceDetailScreen.tsx (`toastFor`) | no confirm dialog; after the click a toast says "Supera el tope diario: saldrá en el próximo envío disponible" |
| Reminder (step 2) with the split button | 4 open question | deviation | — | open question in the mockup; the reminder keeps its plain "Aprobar" |

## 5. How it goes out

| element | mockup ref | status | evidence | notes |
| --- | --- | --- | --- | --- |
| Chosen moment stored in `sequence_draft.scheduled_for`; sends stay in the Sequence runner | 5 | done | src/lib/sequences/approvalQueries.ts, src/lib/sequences/sendMoment.ts | |
| pg_cron job every minute on /api/sequences/run (Vercel crons kept) | 5 | done | scripts/sequences-run-cron.sql | NOT applied; orchestrator applies |
| "Enviar ahora" releases right after approval through the same checks/claim/cap | 5 note | done | src/lib/sequences/releaseNow.ts, src/app/(app)/sequences/actions.ts | pinned in tests/unit/sequencesInert.test.ts |
| Idle tick is one statement | 5 | done | src/lib/sequences/releaseQueries.ts `loadForRun` | measured: 2.0 ms execution with 20,000 members, none due |
| Claim refuses a step moved later since it was read | 5 | done | src/lib/sequences/releaseQueries.ts `notMovedLater` | tests/db/sequenceSendNow.test.ts |
| Cap applies to manual "send now" | 5 question | done | tests/db/sequenceSendNow.test.ts | owner decision: it applies |

Counts: done 38, deviation 6, todo 0.
