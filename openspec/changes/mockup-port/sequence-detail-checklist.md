# /sequences/[id] mockup parity checklist (outreach-sequences PR 11)

Source mockup: `openspec/changes/outreach-sequences/mockups/secuencia-detalle.html`
(live screen plus the reference gallery below it). Spec: `outreach-sequences/specs/sequence-detail-view/spec.md`.
Scope of PR 11: the detail COMPONENTS, unrouted (`src/app/(app)/sequences/_components/`, no `page.tsx`), so the app shell,
the review dialog and the bulk bar belong to other PRs and are listed as deferred, not dropped.

Fixtures and tests use synthetic people only: the mockup holds real production prospects and none of them is copied.

Columns: element | mockup ref | status | evidence | notes

C = `src/app/(app)/sequences/_components`

## Header

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| eyebrow "Secuencia" | page-header | done | C/SequenceHeader.tsx:9 | |
| h1 name + accent dot | page-header | done | C/SequenceHeader.tsx:10 | |
| description with "nada sale sin tu aprobación" bold | page-header | done | C/SequenceHeader.tsx:11 | count is the member total (discarded included) |
| "Editar secuencia" (ghost) | header actions | done | C/SequenceHeader.tsx:14 | reports `editSequence`; the dialog is a later PR |
| "Generar borradores faltantes" (secondary) | header actions | done | C/SequenceHeader.tsx:15 | disabled when no drafted member lacks a draft (a real state, not a placeholder) |
| "Aprobar los N listos" (primary) | header actions | done | C/SequenceHeader.tsx:16 | N = drafted with a draft (`stats.toReview`); disabled at 0; singular copy for 1 |

## Stat cards, progress

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| four `.stat` cards info/accent/neutral/success | grid-4 | done | C/StatCards.tsx:15-27 | values from `sequenceStats` (src/lib/sequences/stats.ts:38) |
| queue foot "salen mañana 09:00" | stat accent | done | C/StatCards.tsx:6-12 | Miami clock; "hoy"/DD/MM when not tomorrow; "nada programado" at 0 |
| "N de M ya salieron · R respuesta(s)" | progress row | done | C/ProgressLine.tsx:11-12 | |
| bar segment sent (success) | bar-track | done | C/ProgressLine.tsx:14 | |
| bar segment queued (info) | bar-track | done | C/ProgressLine.tsx:15 | |
| bar third segment (neutral, "sin salir") | bar-track | done | C/ProgressLine.tsx:7-10,16; src/lib/sequences/stats.ts `segments` | owner decision: mockup wins. Remainder, discarded included, so the bar totals 100%. Spec text corrected |

## Cadencia card

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| card header "Cadencia" + "Cambiar" | card-header | done | C/CadenceCard.tsx:12-15 | |
| Paso 1 row | assoc-row | done | C/CadenceCard.tsx:18 | wording from the Sequence's own schedule |
| Paso 2 row | assoc-row | done | C/CadenceCard.tsx:19 | |
| Fin row with link to Seguimientos | assoc-row | done | C/CadenceCard.tsx:20 | `/follow-ups` |
| help text (2 per company, clients excluded) | help | done | C/CadenceCard.tsx:22 | |

## Member cards

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Contactos de la secuencia" h2 | h2 | done | C/SequenceDetailView.tsx:33 | |
| avatar | card-body | done | C/MemberCard.tsx:92 | shared `Avatar`, colour by person id |
| name linked to the Contact record | card-body | done | C/MemberCard.tsx:95 | `/contacts/{id}` |
| state badge, six states plus no_reply and no-draft | card-body | done | C/MemberCard.tsx:96; mapping src/lib/sequences/memberCard.ts:52-70 | no_reply and "no draft yet" are not in the spec table: see deviations |
| "Florida" outline badge | drafted card | done | C/MemberCard.tsx:97 | drafted only, as in the mockup |
| headline "title en Company" with company link | headline | done | C/MemberCard.tsx:99-102 | `/companies/{key}`; "Sin cargo cargado" when no title. `.headline` is only styled under `.record-identity` in the stylesheet, same as the mockup |
| meta: drafted (postings, correo verificado, nunca contactado / último contacto) | meta | done | C/MemberCard.tsx:16-20 | last contact = max effective activity time |
| meta: approved (Sale mañana DD/MM a las 09:00 · aprobado por ... hace) | meta | done | C/MemberCard.tsx:22-29 | "aprobado por vos", as in the mockup |
| meta: sent (enviado hace · sin respuesta · recordatorio el DD/MM) | meta | done | C/MemberCard.tsx:35,41-44 | |
| meta: reminder due today | meta | done | C/MemberCard.tsx:44 | |
| meta: replied | meta | done | C/MemberCard.tsx:36-38 | |
| meta: discarded (Lo quitaste hace · motivo) | meta | done | C/MemberCard.tsx:30-33 | known codes (opt_out, merge_duplicate) worded; free text shown as typed |
| held member shows its reason in the meta line | spec | done | C/MemberCard.tsx:85 | `holdReasons` is keyed by PR 9's `HoldReason`; a test fails if one is missing |
| chips (vacantes, Liderazgo, Oficina Miami) | chips row | done | C/MemberCard.tsx:86-88,104 | drafted and approved cards only, as in the mockup |
| actions per state | action row | done | C/MemberCard.tsx:54-62; table src/lib/sequences/memberCard.ts | replied offers only "Ver conversación" |
| "Más acciones" menu: Regenerar borrador, Abrir ficha, separator, Quitar de la secuencia | dropdown | done | C/MemberCard.tsx:63-74 | shared `DropdownMenu` (keyboard, Escape, aria) instead of `<details>` |
| actions report intent only | n/a | done | C/actions.ts | wiring to existing server actions and dialogs is PR 12 / go-live |

## States

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| empty state "N contactos, ningún borrador todavía" + "Generar los N borradores" | gallery | done | C/StateCards.tsx:6-18 | no member cards in this state (spec) |
| finished state "Secuencia completa" + counts + "Crear la próxima secuencia" | gallery | done | C/StateCards.tsx:20-34 | no_reply counted from `no_reply` members, discarded excluded |
| finished progress "N de N enviados · R respuestas" | gallery | done | C/ProgressLine.tsx:10 | |
| member cards under the finished state | n/a | deviation | C/SequenceDetailView.tsx:31-39 | OWNER DECISION. The mockup's finished gallery shows only the progress line and the card; the cards are kept below so a replied Contact stays one click away |

## Deferred to other PRs (visible in the mockup, not in this PR's scope)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| sidebar "Secuencias" entry with count | sidenav | deviation | — | PR 13 (go-live). `sequencesInert.test.ts` forbids it before then |
| breadcrumbs "Secuencias / name", topbar | topbar | deviation | — | belongs to the routed page (PR 13) |
| "Revisar borrador" dialog and its anchors (#revisar) | dialog gallery | deviation | — | PR 12 task 12.1 |
| bulk bars and `#aprobar-todos` | bulk-bar gallery | deviation | — | PR 12 task 12.2 |
| `mock-note` annotation | mock-note | n/a | — | mockup annotation, not product UI |
| member pagination | — | deviation | — | PR 13 must paginate if a roster can exceed `SEQUENCE_DETAIL_MEMBER_LIMIT` (200). Nothing caps a roster's size (`COMPANY_MEMBER_LIMIT` is 2 per company, not a total), so `detailQueries.ts` reads one row past the bound and THROWS rather than hand `sequenceStats()` a truncated list to count |

## Owner decisions taken (2026-10-15)

1. Progress bar: the mockup's three segments win; spec corrected.
2. Copy: "aprobado por vos" kept as in the mockup (voseo) — but only for the Sequence's owner. An admin reading
   another BD's Sequence gets "aprobado hace {ago}": the read does not fetch who approved, so the card says when
   and stays quiet about who, rather than crediting the reader with someone else's approval.
3. `/admin/audit-log` now shows `view_sequence` rows (new "Qué se vio" column, Sequence name in the Contact column; src/lib/activity/auditLogQueries.ts, app/(app)/admin/audit-log/page.tsx).
4. Kept: "Sin respuesta" / "Ver correo enviado" and "Sin borrador" wordings, cards under the finished state, admin intro copy, `.headline`, `readAudit.ts:14` swap point.

## PR 12 (first half): review dialog and bulk bar, unmounted (tasks 12.1, 12.2, 12.5)

C = `src/app/(app)/sequences/_components`, L = `src/lib/sequences`. Tests: `tests/unit/sequencesReviewDialog.test.ts`, `tests/unit/sequencesBulkBar.test.ts`.
Components report intent through `OnReviewAction` / `OnBulkAction` (C/actions.ts); the container (PR 13) owns the server actions.

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| one dialog for Revisar borrador / Ver correo / Ver correo enviado / Revisar recordatorio | dialog gallery | done | C/ReviewDialog.tsx; L/reviewDialog.ts:27 | variant from state + step; null when no draft |
| title "name · title en Company" | dialog-header | done | C/ReviewDialog.tsx:51 | shared `Dialog` (close "×", Esc, focus return) |
| info alert "Leelo antes de aprobar" | alert-info | done | C/ReviewDialog.tsx:83 | |
| "Señales usadas" chips + help | field | done | C/ReviewDialog.tsx:92 | chips passed in by the container, worded from the generator input; empty list says so, never invented |
| "Para" read-only + "Desde" + activity line | field | done | C/ReviewDialog.tsx:98 | |
| "Asunto" / "Cuerpo" editable, footer included in the body | field | done | C/ReviewDialog.tsx:103-107 | body is stored with the footer appended |
| help "Editalo libremente..." | help | done | C/ReviewDialog.tsx:107 | hidden when read-only |
| "Cadencia para este contacto" Paso 1 / Paso 2 | assoc | done | C/ReviewDialog.tsx:110-113; L/reviewDialog.ts:31 | |
| footer Regenerar (sparkle) / Guardar sin aprobar / Aprobar y programar | dialog-footer | done | C/ReviewDialog.tsx:72-77 | |
| read-only for sent / replied / no_reply, only Cerrar | spec | done | L/reviewDialog.ts:22; C/ReviewDialog.tsx:81 | |
| reminder variant: intro date + "no vimos ninguna respuesta" | spec | done | C/ReviewDialog.tsx:85 | |
| opening reports "markReviewed" | spec | done | C/ReviewDialog.tsx:44-47 | intent only, once per open, only for an unopened draft |
| "3 seleccionados" / counter / "Regenerar los N" / "Quitar de la secuencia" / "Aprobar y programar los N" | bulk-bar | done | C/BulkBar.tsx:16-26 | gate from `bulkApprovalGate` via L/bulkBar.ts |
| approve disabled until N = M, with the blocked help text | bulk-bar | done | C/BulkBar.tsx:24,28 | |
| bulk remove asks one reason for all | spec | done | C/BulkBar.tsx:32 `RemoveReasonDialog` | copy invented (mockup has none): see deviations |

### Deviations and decisions for the owner

| item | status | notes |
|---|---|---|
| Cadence line for an unapproved draft | deviation | mockup shows "Sale el 15/10 09:00" as fact; a draft has no send time yet, so it reads "Si lo aprobás ahora, sale el ..." (projection from the Sequence's schedule). The approved variant shows the stored time as the mockup does |
| Notice tail "sale bajo tu nombre" | deviation | verbatim for the Sequence owner only; any other reader sees "sale desde la cuenta remitente". The same ownership rule as "aprobado por vos" on the card |
| Approved variant notice | decision | "Aprobado hace {ago}": says when, never who (the read does not fetch the approver) |
| Counter wording | spec vs mockup | the mockup words the complete bar "ya revisados" and the partial one "revisados"; the spec says "revisados" for both. Mockup kept, so the spec scenario "3 de 3 borradores revisados" is satisfied only up to the word "ya" |
| Singular bar copy ("1 seleccionado", "Regenerar el borrador") | addition | mockup only draws N=3 |
| Reason dialog copy (`bulkRemove*`) | addition | the mockup does not draw it; spec requires a reason for all |
| Blocked help text under the bar | kept | drawn under the bar in the mockup, reads like an annotation; shown only while the button is disabled |
| Approved member in the dialog | decision | editable, footer Regenerar + Guardar sin aprobar (no Aprobar on what is approved); saving withdraws the approval, as the spec says |
| Warning before an approval is withdrawn | addition | `reviewApprovedEditWarning`, shown only on the approved variant. `saveDraftEdit` (draftQueries.ts:188) clears `approved_at` and `scheduled_for` and moves the member back to `drafted` — correct, since an approval binds to the exact content, but the mockup lets the BD cancel a scheduled send with no notice. Rendered as plain `help`: the mockup draws no warning, so there is no approved emphasis style, and `help-warn` (which exists in the shipped CSS) would fail the mockup class guard. **Owner: is plain help text enough emphasis, or should PR 13 style it?** |
| `stopped` variant (new, not in the mockup) | addition | The mockup draws one read-only dialog. But `discarded` covers two different facts: dropped BEFORE step 1 released (the common roster case, `sent_at` null) and dropped after. The first was being shown the sent dialog — "este correo ya salió" plus a projected send time for a mail that will never go out, two falsehoods on one screen. `stopped` says the mail was never sent and shows NO cadence rows |

### PR 13 obligations this slice cannot satisfy by itself

The components report intent and hold no state, so the container owns these. None is a defect here; each is a way PR 13 could misuse them.

1. **Refresh the member after `markReviewed` succeeds.** The dialog reports the intent once per open, from an effect. The server side is idempotent (`markDraftReviewed` updates only `where reviewed_at is null`, owner- and state-scoped), so a repeat is harmless — but until the container refetches, `BulkBar`'s "N de M revisados" counter and its approve gate stay stale.
2. **Never approve after a failed save.** The dialog reports `save` and `approve` with the subject and body it holds. An approval binds to the exact content, so the container must save first and approve only once the save succeeded.
3. **Mounting the dialog already open fires `markReviewed` on mount.** That is intended (opening IS the review), but a container that mounts it open for a member nobody chose would record a review nobody did.
4. **Surface the `empty` error.** The fields carry `required`, which stops a blank submit in the browser, but `saveDraftEdit` also refuses whitespace-only content; that error reaches the user only if the container maps it into the dialog's `error` prop.
5. **Select the Contact's memberships by EMAIL ADDRESS, not by `person_id`.** `recordOptOutForMember` suppresses the address and discards every live membership of that address, joining `person` on the email alone. A read keyed on `person_id` undercounts whenever the same address lives on a second Contact row, and the opt-out dialog's count comes from that read. The copy was reworded ("acá ves N", not "tenés N") so it cannot be taken for a complete total, but the right fix is for the read to use the same key the write uses.
6. **The "already opted out" state assumes the read shows every membership of the address.** `contactContext` hides the control when any displayed row carries `discard_reason = 'opt_out'`. That is right today only because the suppression discards them all; a read that filters rows out could hide the control while a live membership survives. Same root cause as 5.
