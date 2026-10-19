# Redactar correo (adjuntos y varios destinatarios) mockup parity checklist

Source mockup: `openspec/changes/email-attachments-recipients/mockups/redactar-email.html`
(updated to the owner's final decisions: CC only @avalith.net, no Bcc, 5 files / 6 MB each / 10 MB total, no downloads
after sending, scheduled chips not downloadable, cancelled files kept 30 days).

Columns: element | mockup ref | status | evidence | notes

## Section 1 - Enviar correo desde la ficha

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Dialog title "Enviar correo" + close | s1 header | done | `src/app/(app)/contacts/[id]/QuickActions.tsx` EmailForm `Dialog title={l.quickActionEmail}` | unchanged |
| "Para" label | s1 `.field .row label` | done | `src/components/email/RecipientFields.tsx:119-123` | label points at the add control |
| "Ocultar CC / Mostrar CC" toggle, `aria-expanded`/`aria-controls` | s1 `.cc-toggle` | done | `RecipientFields.tsx:125` | copy `emailCcShow/emailCcHide` |
| Recipients box (`.rcpt`, group role, aria-label) | s1 `.rcpt` | done | `RecipientFields.tsx:133-145`, CSS `src/app/design-system.css` ".rcpt" block | promoted from mockup-only CSS to the design system |
| Locked chip for the record's contact (avatar, name, email, no x, title) | s1 `.chip.locked` | done | `RecipientFields.tsx:141` | |
| Removable chips with avatar, name, email and x (`aria-label` "Quitar a ...") | s1 `.chip` | done | `RecipientFields.tsx:147-153` | |
| Backspace on empty input removes the last removable chip | s1 note | done | `RecipientFields.tsx` onKeyDown Backspace branch | also in CC |
| "Anadir destinatario" button (`aria-haspopup=listbox`, plus icon) | s1 `.rcpt-add` | done | `RecipientFields.tsx:177-190` | |
| Help "N destinatarios - todos de {empresa}. Cada uno recibe el mismo correo ... y vera a los demas." | s1 `.help` | done | `RecipientFields.tsx:240-244` | shown when more than one recipient |
| CC row (`#c-cc-row`): label, chips, typed input, aria-label | s1 CC field | done | `RecipientFields.tsx` `CcField` | internal @avalith.net only, free-typed chips |
| CC placeholder "Anadir colega @avalith.net" and help "Solo direcciones @avalith.net ... No se registra el correo en su ficha." | s1 (updated) | done | `RecipientFields.tsx:311,378` | |
| CC validation errors (not internal / malformed / too many) | decision 2 | done | `RecipientFields.tsx` `add()`; `src/lib/email/recipients/cc.ts`; server re-check in `prepareCompose` | exact domain, case-insensitive, rejects subdomains and look-alikes |
| CC suggestions from the bd table | decision 2 (optional) | done | `RecipientFields.tsx` suggestions `.picker`; `composeActions.ts` `listColleagueSuggestionsAction`; `recipients/queries.ts` `listColleagueSuggestions` | loaded lazily on first focus |
| Asunto field with hint | s1 | done | `QuickActions.tsx` EmailForm | unchanged |
| Mensaje textarea | s1 | done | `QuickActions.tsx` EmailForm | unchanged |
| "Adjuntos" label + attach bar (button with clip icon, "o arrastralos aqui", live total) | s1 `.attach-bar` | done | `src/components/email/AttachmentsField.tsx:91-112` | total "N archivos - X MB de 10 MB" |
| File chip: name, size, x (`aria-label` "Quitar ...") | s1 `.file` | done | `AttachmentsField.tsx` `FileChip` ready branch | |
| Uploading chip with progress bar, % and cancel | s1 `.file.up` | done | `AttachmentsField.tsx:134-150`; real progress via XHR `src/lib/email/attachments/browserUpload.ts` | |
| Error chips "Supera 6 MB" / "Tipo de archivo no permitido" and discard x | s1 `.file.err` | done | `AttachmentsField.tsx:153-161` | also "Maximo 5 archivos", "Supera 10 MB en total", "No se pudo subir" |
| Drop state "Suelta los archivos para adjuntarlos" | s1 `.dz-hint.over` | done | `AttachmentsField.tsx:52-82,121` | listeners on the whole dialog, as the mockup caption says |
| Help line about limits, errors not sent, Send disabled while uploading | s1 `.help` | done | `AttachmentsField.tsx:125`; Enviar disabled `QuickActions.tsx:695` | |
| Footer: Redactar con IA, Cancelar, Programar..., Enviar | s1 footer | done | `QuickActions.tsx` EmailForm footer | unchanged; draft survives "Redactar con IA" and "Programar..." and back |
| Picker open: combobox input, listbox, menu-label, options (avatar, name, role, email), active row, arrows/Enter/Esc | s1b | done | `RecipientFields.tsx:153-228` | Esc closes the picker, not the dialog |
| Picker option without email disabled with "Sin email" badge | s1b | done | `RecipientFields.tsx:224` | |
| Picker empty state "No hay otros contactos de {empresa} con email" | s2 note | done | `RecipientFields.tsx` empty branch | |
| Typed address of another company rejected: `.rcpt.is-invalid`, `role=alert` error, no chip | s1b right | done | `RecipientFields.tsx:231-235`; `src/lib/email/recipients/picker.ts` `matchTypedAddress` | no free addresses |

## Section 2 - Contacto sin empresa

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Add control disabled with tooltip and help "Este contacto no tiene empresa asignada ..." | s2 | done | `RecipientFields.tsx:181-183,236-240` | `hasCompany` from the record's company key |
| Attachments still available | s2 | done | `QuickActions.tsx:746` | |

## Section 3 - Responder a un hilo con adjuntos

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Para fixed and disabled, no picker, no CC | s3 | done | `src/app/(app)/contacts/[id]/ReplyDialog.tsx` (unchanged recipient input) | recipients derived from the thread as before |
| Attachments row with the same behaviour and limits | s3 | done | `ReplyDialog.tsx:106`; `sendThreadReplyAction(..., attachments)` | reply keeps the thread (threadId in the upload metadata) |

## Section 4 - Linea de tiempo tras enviar

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| One `email_sent` on the record of EACH Para contact, sharing one email_message | s4 | done | `src/lib/gmail/sentEmailQueries.ts` `activitiesOf`/`insertActivities`; DB test `tests/db/emailRecipientsAndAttachments.test.ts` | every Para contact moves to Contactado |
| "Para: A, B, +N - CC: x" line, tooltip with emails on +N | s4 `.to-line` | done | `src/components/email/AttachmentChips.tsx` `RecipientsLine`; `Timeline.tsx:927-936,1112,1468` | up to 2 names |
| Attachment chips: name and size | s4 `.files` | deviation | `AttachmentChips.tsx`; `Timeline.tsx:934,1113` | NOT links and no download icon: the owner decided the CRM keeps no files and offers no download after sending (mockup updated) |
| Colleagues in CC get no activity | decision 3 | done | only Para persons receive `alsoRecordFor` (`send.ts`) | |

## Section 5 - Correo programado con adjuntos

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Para:" line with names and +N | s5 | done | `src/app/(app)/scheduled/ScheduledCard.tsx:85` | |
| File chips, informational (not links) | s5 | done | `ScheduledCard.tsx:43,63,90` | also on held and failed cards |
| Reprogramar edits recipients, Cc and files, same rules | s5 alert | done | `ScheduleEmailDialog.tsx:108-123`; `useScheduledActions.tsx`; `editScheduledEmailAction(..., extras)` | the alert text is shown in the edit dialog |
| Schedule dialog keeps recipients and files from "Enviar correo" | s1 note | done | `QuickActions.tsx` `compose={{ draft, ... }}` | same draft object |
| Scheduling WITH files refused up front without the service-role key | decision (secrets) | done | `scheduleActions.ts` `attachments_unavailable`; dialog alert `ScheduleEmailDialog.tsx:124` | |
| Files kept until dispatch; deleted right after sending; cancelled 30 days; failed keep files | s5 notes (updated) | done | `scheduledEmail/send.ts`; sweeper `attachments/queries.ts` `selectSweepable`, `run/route.ts` | DB test covers the selection |
| "Programados" list shows recipients/file counts | s5 | done | `ScheduledListView.tsx` meta line under the subject | small addition, not in the mockup table |

## Section 6 - Que hace y que no

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Destinatarios rule (same company, with email, no free addresses, no company = only the contact) | s6 | done | `src/lib/email/recipients/para.ts`, `queries.ts` (aliases, merges) | server is the authority |
| Tamano: 5 files, 6 MB each, 10 MB total | s6 (updated) | done | `src/lib/email/attachments/policy.ts` | real size re-read from Storage at send time |
| Tipos permitidos only (pdf, docx, xlsx, pptx, doc, xls, ppt, png, jpg, txt, csv) + magic bytes | s6 (updated) | done | `policy.ts`, `magic.ts`, `load.ts` | |
| Donde aplica: Enviar, Programar, Responder (solo adjuntos) | s6 | done | see sections 1, 3, 5 | |
| Secuencias do not take files or several recipients | s6 | done | sequences call `sendGmailMessageFromAccount` without the new fields | untouched |
| Registro: per Para recipient, name and size, no download | s6 (updated) | done | see section 4 | |
