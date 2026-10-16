# sequences-admin-read checklist

Mockups: `openspec/changes/sequences-admin-read/mockups/secuencia-detalle-solo-lectura.html` (detail) and `secuencias-lista-admin.html` (list).
Owner decisions 2026-10-16: admin reads all, read-only on others, no audit.

## Detail, read-only (slice 1)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Neutral banner "Secuencia de <BD>. Solo lectura." + body | detalle:59 | done | src/app/(app)/sequences/_components/SequenceDetailView.tsx:34 | alert-neutral, eye icon |
| Intro worded around the owner, sender account shown | detalle:62 | done | src/app/(app)/sequences/_components/SequenceHeader.tsx:16 | open question (b) built as "yes" |
| "Volver a Secuencias" -> Todas tab | detalle:64 | done | src/app/(app)/sequences/_components/SequenceHeader.tsx:16 | open question (c) built as "yes"; `?scope=all` handled by slice 2 |
| Editar secuencia / Aprobar los N listos ABSENT | detalle:54 | done | SequenceHeader.tsx:16 | not rendered |
| Four stat cards, progress line | detalle:67-77 | done | SequenceDetailView.tsx (unchanged blocks) | read-only, same data |
| Cadencia card without "Cambiar" | detalle:79-87 | done | src/app/(app)/sequences/_components/CadenceCard.tsx:14 | |
| Finished state without "Crear la próxima secuencia" | detalle:54 | done | src/app/(app)/sequences/_components/StateCards.tsx:27 | |
| No bulk bar, no selection checkboxes | detalle:54 | done | SequenceDetailView.tsx (`!readOnly && bulk`, :43), SequenceDetailScreen.tsx (bulk null) | |
| Draft card: "Ver borrador" + menu "Abrir ficha" only | detalle:100 | done | src/lib/sequences/memberCard.ts:55 | tests/unit/sequencesReadOnly.test.ts |
| No-draft card: only "Abrir ficha" | detalle:117 | done | src/lib/sequences/memberCard.ts:55 | |
| Approved card: "Ver correo" only, "aprobado hace 2 h" (no "por vos") | detalle:126 | done | MemberCard.tsx (approvedByOther) | |
| Replied card: "Ver conversación" + "Abrir ficha"; no "No contactar" nor phrase prompt | detalle:143 | done | MemberCard.tsx:119, memberCard.ts menu filter | |
| Sent / no-reply card: "Ver correo enviado" only | detalle:151 | done | memberCard.ts | |
| Reminder-due card: "Ver recordatorio" only | detalle:167 | done | memberCard.ts, dictionaries `actions.viewReminder` | |
| Discarded card: no actions (no "Reincorporar") | detalle:174 | done | memberCard.ts | |
| Review dialog: neutral notice, readonly fields, only "Cerrar", no "Señales usadas", does not mark reviewed | detalle:183-218 | done | ReviewDialog.tsx:74, reviewDialog.ts:47-50 | |
| Write intents dropped in the container (defense in depth) | detalle:54 | done | SequenceDetailScreen.tsx (`isReadOnlyAction`) | server already refuses (DB test) |
| Admin read costs one statement, no audit row | owner decision | done | src/lib/sequences/detailQueries.ts (getSequenceDetail) | tests/db/sequenceDetail.test.ts |
| Old `view_sequence` rows still listed in the audit log | owner decision | done | src/lib/sequences/readAudit.ts, tests/db/sequenceDetail.test.ts | |
| Server refuses writes on a foreign Sequence | owner decision | done | tests/db/sequenceDetail.test.ts "ACTING on another BD's Sequence" | approve, save, cancel, remove, settings, opt-out |

## List (slice 2)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Admin intro ("Las de otros BD se abren en solo lectura") | lista:60 | done | src/app/(app)/sequences/_components/SequenceListView.tsx:63 | admin only; BD intro unchanged |
| Tabs Mías / Todas with counts, default Mías | lista:62 | done | SequenceListView.tsx:19, src/lib/sequences/listScope.ts:14 | `/sequences`, `/sequences?scope=all` |
| BD never sees others' rows by URL | owner decision | done | src/app/(app)/sequences/page.tsx:18-24, tests/unit/sequencesListScope.test.ts | non-admin takes the unchanged own-only read |
| Responsable filter chip (menu with avatar, name, (yo), count) | lista:101 | done | SequenceListView.tsx:27 | Todas only |
| Applied chip "Responsable: X" removable, "Borrar todo", note | lista:181 | done | SequenceListView.tsx:27 | remove is a GET form + button (only mockup classes) |
| Responsable column (owner-chip, "(yo)" on own rows) | lista:70,74 | done | SequenceListView.tsx:105,112 | shown to the admin on BOTH tabs, as the mockup draws it |
| Foreign row menu: only "Abrir secuencia"; own row keeps "Editar secuencia" | lista:130 | done | SequenceListView.tsx:138 | static markup cannot see the menu; logic is `own` |
| Stat cards computed on visible rows; "Borradores por revisar" and "Aprobados, en cola" hidden on Todas | lista:103-108 + owner decision | deviation | SequenceListView.tsx:89 | mockup draws all four on Todas; owner decided to hide two |
| Footers: Mías / Todas ("N secuencias de M BD") / one BD | lista:93,173,212 | done | SequenceListView.tsx:91 | |
| Mías empty state with "Ver todas" + "Nueva secuencia" | lista:220 | done | SequenceListView.tsx:77 | |
| Sidebar pill keeps counting own Sequences | lista:55 (7) | done | unchanged | not touched |
| One round trip, no limit | lista:56 | done | src/lib/sequences/pageQueries.ts:45 | revisit past ~50 rows (mockup note) |
