# draft-language-mismatch — mockup

File: `borrador-otro-idioma.html` (desktop only, same shell as `preferred-language/mockups/idioma-preferido.html`,
stylesheet `crm-hubspot-ux/mockups/styles.css`, no new classes, no new colors).

Problem (owner-approved to work on, 2026-10-27, `openspec/BACKLOG.md` entry "Preferred language: nothing flags an unapproved draft
written in the old language"): when the language we would write in today differs from the language an existing UNAPPROVED draft was
generated in (a preferred language was loaded, a country was corrected, colleagues changed the consensus, a one-off choice was reset),
nothing says so and it can be approved and sent in the wrong language. Evidence from the code, read 2026-10-27:

- `complianceRefusal` (`src/lib/sequences/complianceGate.ts:22-27`) only checks the address and that a footer exists.
- `bodyHasFooter` (`src/lib/sequences/complianceFooter.ts:48-52`) accepts the opt-out sentence in ANY configured language
  (`ALL_OPT_OUT_TEXTS.some`, line 51), on purpose (comment at lines 43-47).
- `addressesNow` (`src/lib/sequences/approvalQueries.ts:78-85`) recomputes only the address; `approve` (line 91) is the one path for
  single (`approveMember`, line 143) and bulk (`approveBulk`, line 146).

Owner rules this design keeps: drafts are regenerated ONE contact at a time (no bulk regenerate), and the bulk approval gate (every
draft must have been opened) is load-bearing and is not weakened: this change only ADDS one more condition to it.

## Existing design found?

No. Searched `openspec/changes/*/mockups/` (outreach-sequences, draft-audience-reason, draft-language-choice, audience-roster-consensus,
preferred-language, draft-reviewed-flag, follow-up-queue, sequence-bounce-optout, scheduled-send) and the real components
(`SequenceDetailScreen.tsx`, `MemberCard.tsx`, `AudienceBlock.tsx`, `LanguageChoiceDialog.tsx`, `ReviewDialog.tsx`, `BulkBar.tsx`,
`RegenerateConfirmDialog.tsx`). Nothing draws a "stale / outdated / wrong-language draft" state. What exists and is reused:

| Need | Reused from |
| --- | --- |
| Warning chip | `badge badge-warn` as "Sin revisar" (`MemberCard.tsx:198`) |
| Alert with action buttons on a card | the opt-out prompt, `alert alert-warn` + `grow` + button (`MemberCard.tsx:213-216`); the compact padding of the roster-split alerts (`AudienceBlock.tsx:121`) |
| Alert at the top of the review dialog | the stale-version alert (`ReviewDialog.tsx:120-126`) |
| Reason in the bar, not outside it | `<p class="note">` inside the sticky `.bulk-bar` (`BulkBar.tsx:51`, rule of `draft-reviewed-flag`) |
| Disabled control + `title` | `Aprobar` and the bulk button already use it (`BulkBar.tsx:42`, `MemberCard.tsx:118-119`) |
| The way out that keeps a human choice | the one-off language choice ("elegido por una persona", `draft-language-choice`) |
| Regenerate flow | the language dialog already asked before every regenerate (`SequenceDetailScreen.tsx:216`, `LanguageChoiceDialog.tsx`) and the hand-edit confirmation (`RegenerateConfirmDialog.tsx`) |

## Panels

### A. The member card (A1 to A4)

The card of siempre plus three things, all only when the draft language differs from the language of today
(`memberLanguage(m).language`, which already applies one-off > preferred > audience):

- Badge `badge badge-warn` "Otro idioma" next to "Borrador" / "Sin revisar" (with a `title`: "El borrador está en inglés; hoy le escribiríamos en español").
- An `alert alert-warn` inside the card, below the audience block, with the sentence, the reason in parentheses and two buttons:
  "Regenerar en {now}" (`btn-secondary`) and "Mantener en {draft}" (`btn-ghost`). The reason is the same fragment the card's "↳" line
  already uses, so the two cannot disagree.
- "Aprobar y enviar ahora" disabled with a `title` that names the reason. The selection checkbox is disabled (see C).

Cases: A1 preferred language loaded after generating (en to es). A2 person country corrected, address unchanged (es to en). A3 one-off
choice reset AND the draft was hand-edited: the alert adds the edit warning and the safe route is "Mantener". A4 the state after
"Mantener en inglés": no alert, no badge, the existing "elegido por una persona" card, approve enabled.

"Regenerar en {now}" opens the already-approved language dialog in regenerate mode with {now} preselected (it asks every time by rule); if the
draft was hand-edited the existing "¿Regenerar y perder tu versión?" confirmation still comes first from the server. "Mantener en {draft}" writes
the existing one-off choice (`sequence_member.draft_language`) with the actor and time and generates nothing.

### B. The review dialog (B1 recommended, B2 alternative)

- B1: warn alert at the top of the dialog (`role="alert"`) with the same two buttons and one explanatory paragraph (what each does), a badge
  "en inglés" next to the body label, "Aprobar y enviar ahora" disabled, and a `help` line glued to the footer ("Aprobar se habilita cuando el idioma
  del borrador coincide con el que usaríamos hoy"), linked with `aria-describedby`: the top alert can scroll out of view, the footer cannot.
- B2: the alternative asked by the owner, "Aprobar igual en inglés" with a confirmation dialog. OWNER DECISION below.

### C. Bulk approval (C1, C2)

- C1: a draft in another language cannot be selected: its checkbox is disabled with the reason in `title` and the reason is also visible on the
  card itself (the alert), so it does not depend on a tooltip. "Aprobar los N listos" (`readyMemberIds`, `detailFlow.ts:56`) leaves it out of N.
  The sticky bar says what was left out in its `note` line, so the reason travels with the button when the page scrolls
  (memory: a disabled control in a sticky bar loses its explanation).
- C2: safety net. If the language changed while the page was open, a selected draft can be in another language. Its checkbox stays enabled (to
  deselect it) and the bar blocks the whole bulk with the reason inside the bar, exactly like the unopened-drafts block (`bulkApprovalGate`).
  The server repeats the rule on rows it reads itself and rejects the whole request with `wrong_language`, the same all-or-nothing semantics as
  `unreviewed` (`approvalQueries.ts:126-129`). No bulk regenerate is drawn.

### D. Normal state

The approved card of `preferred-language` unchanged: no badge, no alert, checkbox and approve enabled. The review dialog is the one of
`outreach-sequences/secuencia-detalle.html`. When the draft language cannot be known (see the data question) nothing is flagged.

### E. Open decision: reminder in another language than step 1

The step 2 reminder is generated days later with the language of that moment (BACKLOG entry "a step 2 reminder follows the preference at the
time it is generated"). E shows what flagging it would look like. Note for the builder: "Regenerar" of a reminder today resolves the language again
(`SequenceDetailScreen.tsx:316` only asks the language for step 1), so "Regenerar en inglés" only works if the reminder takes the language of step 1.

## Classes reused

All from `crm-hubspot-ux/mockups/styles.css`, checked by script against every `class=`: `alert`, `alert-info`, `alert-warn`, `assoc`, `assoc-row`,
`avatar`, `badge`, `badge-info/-mono/-success/-verified/-warn`, `btn`, `btn-ghost/-icon/-primary/-secondary/-sm`, `bulk-bar`, `card`, `card-body`,
`card-header`, `chip`, `data`, `dialog`, `dialog-body/-footer/-header`, `dropdown`, `field`, `grow`, `help`, `input`, `label`, `menu`, `menu-item`,
`menu-label`, `menu-sep`, `meta`, `mono`, `row`, `row-lg`, `stack`, `stack-sm`, `tag`, `tag-scope`, `textarea`, `wrap`, plus the page shell.

One local `<style>` block, five rules copied verbatim from the app's `src/app/design-system.css` (467-480 and 610): `.bulk-bar` wrapping,
`.bulk-bar .count`, `.bulk-bar .sep`, `.bulk-bar .note`, `.headline`. The mockup stylesheet does not carry them, so without them the bar and its reason
line would render unstyled. Same precedent as `draft-reviewed-flag/mockups/marca-de-revisado.html`. `.bulk-bar` is not sticky in the mockup (a static page);
in the app it is. Small inline `style` (padding of the compact alert, flex gaps) as the approved mockups already do.

## Spanish strings proposed (es dictionary, `sequences.languageMismatch`)

Internal CRM copy, voseo. `{draft}` and `{now}` are "español" / "inglés" (`audience.langEs/langEn`).

| key (suggested) | text |
| --- | --- |
| `badge` | Otro idioma |
| `badgeTitle` | El borrador está en {draft}; hoy le escribiríamos en {now} |
| `lead` | El borrador está en {draft}, pero ahora le escribiríamos en {now} |
| `blocked` | El correo no se puede aprobar así. |
| `reasonPreferred` | idioma preferido de {name}, cargado por {by} el {when} |
| `reasonCountry` | por el país de {name}, {country} |
| `reasonCompany` | por el país de {company}, {country} |
| `reasonReset` | se volvió al idioma resuelto, por el país de {company}, {country} |
| `regenerate` | Regenerar en {now} |
| `keep` | Mantener en {draft} |
| `approveTitle` | El borrador está en {draft}. Regeneralo en {now} o mantenelo en {draft} antes de aprobar. |
| `editedWarning` | Lo editaste a mano: regenerarlo reemplaza tu texto y no se puede recuperar. Si el texto está bien, mantenelo en {draft}. |
| `editedWarningOther` | Se editó a mano: regenerarlo reemplaza el texto editado y no se puede recuperar. |
| `dialogLead` | Este borrador está en {draft}. |
| `dialogBody` | Ahora le escribiríamos en {now} ({reason}). Si lo aprobás así, el correo sale en {draft}, por eso no se puede aprobar todavía. |
| `dialogHowRegenerate` | Regenerar abre el diálogo de idioma, con {now} elegido, y reemplaza este texto. |
| `dialogHowKeep` | Mantener no toca el texto: guarda que elegiste {draft} para este contacto en esta secuencia (queda en la tarjeta con tu nombre) y el recordatorio también sale en {draft}. |
| `dialogBodyBadge` | en {draft} |
| `dialogApproveHelp` | Aprobar se habilita cuando el idioma del borrador coincide con el que usaríamos hoy. |
| `selectTitle` | Está en {draft} y hoy le escribiríamos en {now}: regeneralo o mantenelo para poder aprobarlo en bloque |
| `barLeftOut` / `barLeftOutMany` | Quedó afuera 1 borrador en otro idioma: {names}. Regeneralo o mantenelo en su idioma para incluirlo. / Quedaron afuera {n} borradores en otro idioma: {names}. Regeneralos o mantenelos en su idioma para incluirlos. |
| `barBlocked` / `barBlockedMany` | 1 de los seleccionados está en otro idioma: {names}. Sacalo de la selección o corregilo para aprobar. / {n} de los seleccionados están en otro idioma: {names}. Sacalos de la selección o corregilos para aprobar. |
| `reviewErrors.wrong_language` | Este borrador está en otro idioma que el que usaríamos hoy. Regeneralo o mantenelo en su idioma antes de aprobar. |
| `toastKept` | Listo: este borrador queda en {draft}. |

Only if the owner picks the alternative (B2): `overrideAction` "Aprobar igual en {draft}", `overrideTitle` "¿Aprobar igual en {draft}?",
`overrideBody` "Ahora le escribiríamos en {now} ({reason}). Si seguís, el correo sale en {draft} y queda registrado que lo aprobaste así.",
`overrideCancel` "Cancelar".

Only if the owner wants the reminder flagged (E): `reminderLead` "El correo del paso 1 salió en {step1}, pero este recordatorio está en {draft}".

Existing strings reused unchanged: `badgeUnreviewed`, `badgeReviewed`, `languageChoice.chosenBadge/chosenBy/chosenOn/menuChange/menuReset`,
`audience.preferredBy/preferredWithout/langEs/langEn`, `regenConfirm*`, `bulkBlockedWhy`, `bulkReviewedAll`, `reviewApprove*`.
The English body and footer shown in B1 are prospect-facing sample text copied from the approved footer strings.

## Decisions the owner must approve

1. OWNER DECISION: may a BD approve in the old language anyway? Options:
   - (A) Hard block: only "Regenerar en {now}". Simple, but a BD who knows the contact reads the draft's language has no way out except regenerating
     (and losing a hand edit).
   - (B) Recommended, drawn in B1: no "Aprobar igual". The way out is "Mantener en {draft}", which writes the existing one-off choice. Reasons: it leaves a
     visible trace (who, when, "sin esa elección sería ..."), it makes the draft match the language of today so the gate needs no exception, it keeps the
     review-then-approve order, and the reminder follows the same choice (the one-off wins in `resolveDraftLanguage`), which closes decision 2 for this case.
   - (C) Drawn in B2: "Aprobar igual en inglés" with a confirmation. One click less, but it needs a new override record, an exception in the release re-check
     (otherwise `preSendChecks` holds it at send time) and it leaves the reminder free to switch language.
2. OWNER DECISION (b), `BACKLOG.md` "a step 2 reminder follows the preference ...": flag a reminder whose language differs from the step 1 that went out (panel E)?
   Recommendation: do not flag; prevent. Pin the reminder to the language step 1 went out in (needs the language recorded, see the data question), so the
   mismatch cannot be created. A flag is only needed if the owner wants to allow a deliberate switch.
3. Approved but not yet sent drafts. The task covers UNAPPROVED drafts. An approved draft waiting for its slot can hit the same case. If the check lives in
   `complianceRefusal` it also holds those at release (`preSendChecks.ts:91` calls the same predicate), shown as the existing "En espera ... revisión previa". Say if
   release should hold them (recommended, one predicate) or only approval should refuse.
4. "Regenerar en {now}" opens the language dialog again (drawn). Alternative: regenerate in one click because the button already names the language. Recommended:
   keep the dialog (rule "asked before EVERY generate", it also shows the footer preview).
5. A draft whose language cannot be known is not flagged (recommended): never mark what cannot be proved. The alternative (flag every unknown) would mark every legacy draft.
6. "Aprobar los N listos" leaves mismatched drafts out of N (drawn). Alternative: count them and block. Recommended: leave out, as drawn, so one stale draft never hides the rest.

Approved:

## Data question for the builder (not decided)

`sequence_draft` has no language column (`src/db/schema.ts`, columns: subject, body, review and approval stamps; BACKLOG entry on the reminder says the same).
Options seen:

1. Store the language at generation, backfill existing rows. Nullable `sequence_draft.language` (`es` | `en`) written by the generate, regenerate and reminder paths
   from the same `resolveDraftLanguage` result they already pass to `appendFooter`. Backfill from the opt-out sentence in the stored body (`OPT_OUT_TEXT`, exact match).
   Pros: exact, survives a later change of the sentence, gives step 2 the language of step 1. Cons: a migration (plus its rollback file; mind the Drizzle journal
   `when` gotcha), and the backfill has a hole: `complianceFooter.ts:43-47` says drafts stored before the sentence was translated hold the English sentence even
   when the body may not be English, so a backfill would label them `en`.
2. Infer at read and approval time from the opt-out sentence, no schema change. Pros: nothing to migrate or keep in sync. Cons: it reads a sentence the BD can edit away
   (then `missing_footer` already trips), has the same legacy hole as above, gives no anchor for step 2, and breaks silently if the sentences are ever reworded.
3. Column for new rows, inference only where the column is NULL (no backfill write). Pros: no wrong guess is written to the database; legacy rows are judged by
   the sentence only while they last. Cons: two code paths until the legacy drafts are gone; the unknown case (decision 5) must still be defined.
4. Detect the language of the body text. Listed because it is visible, not recommended: heuristic, hand edits and mixed text defeat it, and it cannot be tested exactly.

Whatever is chosen, the comparison should be ONE pure predicate shared by the card, the dialog, single and bulk approval and (decision 3) the release re-check,
as `complianceRefusal` already is for the address, with a new reason code `wrong_language` next to `missing_footer`; and the language of today must come from
`resolveDraftLanguage` / `memberLanguage` (one-off > preferred > audience), never recomputed. Before choosing between 1 and 3, count how many unapproved drafts today
carry an opt-out sentence different from `resolveDraftLanguage`: not measured, no query was run for this mockup.

## Not covered

Bulk regenerate (removed on purpose), notifying a BD that a draft became stale outside this screen, and the contacts list. The sequence list counters are unchanged.
