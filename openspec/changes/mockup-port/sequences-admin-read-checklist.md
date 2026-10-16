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
