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
