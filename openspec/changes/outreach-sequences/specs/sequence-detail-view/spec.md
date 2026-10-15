# Sequence Detail View Specification

## Purpose

Define the desktop (1280px+) Sequence screens and every state shown in the approved mockup `mockups/secuencia-detalle.html`: the sidebar entry, the detail page with stats and member cards, the review dialog, the bulk bars, the empty state, and the finished state. UI copy is Spanish and is quoted verbatim; this spec is written in English.

## Requirements

### Requirement: Sidebar entry

The sidebar MUST contain a "Secuencias" entry directly below "Seguimientos" with a count badge. The badge counts the BD's active (not yet complete) Sequences.

#### Scenario: Entry and badge

- GIVEN a BD with 2 active Sequences
- WHEN any app page renders
- THEN "Secuencias" appears below "Seguimientos" with the badge 2

### Requirement: Desktop only

Sequence screens MUST be designed for 1280px and wider. No mobile or narrow layouts are required, and no mobile screenshots or tests are in scope.

#### Scenario: No narrow-viewport acceptance

- GIVEN the acceptance suite
- WHEN it is reviewed
- THEN it contains no viewport below 1280px for Sequence screens

### Requirement: Sequence header and cadence panel

The page MUST show the Sequence name, the owner-facing description that nothing leaves without approval, and the header actions "Editar secuencia", "Generar borradores faltantes", and a primary "Aprobar los N listos" (N = members in `drafted` with a draft). A "Cadencia" card MUST list Paso 1, Paso 2, and Fin as in the mockup, and state the 2-per-company limit and client exclusion.

#### Scenario: Primary action reflects ready drafts

- GIVEN 3 members in `drafted` with drafts
- WHEN the page renders
- THEN the primary button reads "Aprobar los 3 listos"

#### Scenario: Primary action is bulk-gated

- GIVEN those 3 drafts were not all opened
- WHEN the BD clicks "Aprobar los 3 listos"
- THEN the bulk-bar review gate applies (see `sequence-approval`)

### Requirement: Stat cards and progress are computed from member data

Four stat cards MUST be shown, each computed from current member states:

| Card | Value |
|------|-------|
| "Borradores por revisar" | members in `drafted` that have a draft, excluding reminders |
| "Aprobados, en cola" | members in `approved`, with the next release instant in the foot ("salen mañana 09:00") |
| "Enviados" | members whose step 1 has been sent, including those who later replied; foot shows how many are awaiting a reminder |
| "Respondieron" | members in `replied`; foot "pasó a Seguimientos" |

The progress line MUST read "X de N ya salieron" with X = members whose step 1 was sent, and the bar MUST have three segments proportional to the total: sent, queued, and a neutral remainder "sin salir" (everything neither sent nor queued, so it holds the drafts to review AND the discarded members). The three always add to 100%, matching the approved mockup (40% / 20% / 40% on its dataset); a track that stops short reads as a rendering bug.

#### Scenario: Counters match the cards

- GIVEN the mockup dataset (3 drafted, 2 approved, 3 sent without reply, 1 replied after being sent, 1 discarded)
- WHEN the page renders
- THEN the cards show 3, 2, 4 (3 awaiting reminder), 1
- AND the progress line says 4 de 10 ya salieron

#### Scenario: The bar always fills

- GIVEN the mockup dataset (3 drafted, 2 approved, 4 sent or replied, 1 discarded)
- WHEN the progress bar is computed
- THEN the segments are 40% sent, 20% queued and 40% "sin salir"
- AND they add to 100%

#### Scenario: Discarded members count in the total

- GIVEN 10 members of which 1 is discarded
- WHEN the progress is computed
- THEN N is 10

### Requirement: Member cards per state

Each member MUST be a card with avatar, name linked to the Contact record, state badge, headline "title en Company" linked to the Company record, a meta line, and chips. Cards MUST render as follows:

| State | Badge | Meta | Actions |
|-------|-------|------|---------|
| `drafted` | "Borrador listo" (`badge-info`) plus "Florida" outline when applicable | postings count, email "verificado", "nunca contactado" or last contact | "Revisar borrador", "Aprobar", menu: "Regenerar borrador", "Abrir ficha", "Quitar de la secuencia" |
| `approved` | "Aprobado" (`badge-brand`) | "Sale mañana DD/MM a las 09:00 · aprobado por vos hace ..." | "Ver correo", "Cancelar envío" |
| `sent` | "Enviado" (`badge-contacted`) | "Correo enviado hace N d · sin respuesta · recordatorio el DD/MM" | "Ver correo enviado", "Adelantar recordatorio" |
| `sent`, reminder due today | "Recordatorio hoy" (`badge-warn`) | "el paso 2 sale hoy 09:00" | "Revisar recordatorio", "Aprobar" |
| `replied` | "Respondió" (`badge-replied`) | "respondió hace ... · secuencia detenida para este contacto" | "Ver conversación" |
| `discarded` | "Descartado" (`badge-discarded`) | "Lo quitaste hace ... · motivo: ..." | "Reincorporar" |

Held members (suppression, client status, stale sync, missing footer, account error, failed send) MUST show their hold reason on the card in the meta line.

#### Scenario: Approved card

- GIVEN a member approved 2 hours ago for tomorrow
- WHEN the page renders
- THEN the badge is "Aprobado" and the actions are "Ver correo" and "Cancelar envío"

#### Scenario: Held card shows reason

- GIVEN a member held because the sync is stale
- WHEN the page renders
- THEN the meta line states the reason

#### Scenario: Replied card

- GIVEN a member in `replied`
- WHEN the page renders
- THEN no approve or reminder action is offered

### Requirement: Review dialog

"Revisar borrador", "Ver correo", "Ver correo enviado", and "Revisar recordatorio" MUST open one dialog. It MUST show: the auto-generated notice ("Leelo antes de aprobar"), "Señales usadas", read-only "Para", the "Desde" line, editable "Asunto" and "Cuerpo" (including the compliance footer), and the per-contact "Cadencia". The footer actions MUST be "Regenerar", "Guardar sin aprobar", and "Aprobar y programar". Opening the dialog for a draft MUST set its reviewed flag. For `approved` the dialog is editable and edits withdraw approval; for `sent`, `replied`, `no_reply` it is read-only.

#### Scenario: Dialog contents

- GIVEN a `drafted` member
- WHEN the BD opens "Revisar borrador"
- THEN all listed fields and the three footer actions are present

#### Scenario: Help text about edit protection

- GIVEN the Cuerpo field
- WHEN it renders
- THEN the help text says an edited version is saved and not regenerated automatically

#### Scenario: Sent dialog is read-only

- GIVEN a `sent` member
- WHEN the BD opens "Ver correo enviado"
- THEN the fields are read-only and only a close action is offered

### Requirement: Bulk bar

Selecting rows MUST show the bulk bar with "N seleccionados", the reviewed counter, "Regenerar los N", "Quitar de la secuencia", and "Aprobar y programar los N". The approve button MUST be disabled until all selected drafts have been opened (see `sequence-approval`). Bulk "Quitar de la secuencia" MUST ask for a reason applied to all.

#### Scenario: Incomplete review

- GIVEN 3 selected and 1 reviewed
- WHEN the bar renders
- THEN "1 de 3 borradores revisados" is shown and the approve button is disabled

### Requirement: Empty state

A Sequence with members and no drafts MUST show the empty state "10 contactos, ningún borrador todavía" (with the actual member count) and a primary "Generar los 10 borradores" action.

#### Scenario: Freshly created

- GIVEN a Sequence with 10 members and no drafts
- WHEN the page renders
- THEN the empty state with "Generar los 10 borradores" is shown and no member cards are

### Requirement: Finished state

When no member is in `drafted`, `approved`, or awaiting a reminder, the page MUST show the "Secuencia completa" state with the replied and no-reply counts ("3 de 10 respondieron y ya están en Seguimientos. Los 7 restantes quedaron sin respuesta después del recordatorio.") and a "Crear la próxima secuencia" action. Discarded members are excluded from the "no reply" count.

#### Scenario: Complete

- GIVEN 10 members, 3 `replied`, 7 `no_reply`
- WHEN the page renders
- THEN the finished state shows "3 de 10" and "7"

#### Scenario: Discarded not counted as no-reply

- GIVEN a finished Sequence with 1 discarded member
- WHEN the finished copy is computed
- THEN the discarded member is not counted among the unanswered

### Requirement: Design system consistency

Sequence screens MUST reuse the approved `crm-hubspot-ux` components and classes (badges, `.bulk-bar`, `.empty`, `.dialog`, `.stat`, `.assoc`, `.chip`). The mockup introduces no new CSS classes; the implementation MUST NOT either.

#### Scenario: No new design tokens

- GIVEN the implemented Sequence screens
- WHEN compared to `styles.css`
- THEN every class used exists in the approved design system

### Requirement: Contact record shows Sequence context

A Contact that is a member of a Sequence SHOULD show membership and state on the Contact record, and sends MUST appear in the existing timeline as `email_sent` entries (see `sequence-scheduling`).

#### Scenario: Timeline entry

- GIVEN a Sequence send to a Contact
- WHEN the Contact record opens
- THEN the email-sent activity appears in the timeline
