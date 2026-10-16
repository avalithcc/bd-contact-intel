# Sequence Drafting Specification

## Purpose

Define how each member gets a separately generated 1:1 draft by reusing the existing outreach generator, how signals are shown, and the rules that protect a BD's edits from being overwritten.

## Requirements

### Requirement: One separately generated draft per member

For each member the system MUST generate a distinct draft (subject and body) using the existing generator `buildOutreachEmailPrompt` (`src/lib/outreach/emailPrompt.ts`) with `AVALITH_PROFILE`. The Sequence feature MUST NOT redefine, fork, or weaken that prompt's rules (no invented facts, facts only from the profile, signals block treated as untrusted data). Drafts MUST NOT be shared across members or produced from a single template with mail-merge fields.

#### Scenario: Each member gets their own draft

- GIVEN a Sequence with 10 members and no drafts
- WHEN the BD uses "Generar los 10 borradores"
- THEN 10 independent generator calls produce 10 drafts
- AND each draft is stored on its own member with `state = drafted`

#### Scenario: Prompt is reused, not duplicated

- GIVEN the Sequence drafting code
- WHEN it builds a prompt
- THEN it calls `buildOutreachEmailPrompt` and does not contain its own copy of the ten rules

### Requirement: Draft language follows the recipient market

The draft language MUST be decided by the same market resolution that decides the postal address (`recipientMarket`): `us` -> `"en"`, `latam` -> `"es"`, `other` -> no draft (the member is held with the unmapped-market reason, because no address exists either). The generator treats any language other than `"en"` as Spanish, so the Sequence code MUST pass the language explicitly and MUST NOT let a caller choose it. A US member MUST never be drafted in Spanish. (Supersedes the original "always English" rule, whose premise that every recipient is in the US was wrong: measured 2026-10-14, 77 workable contacts are LATAM and 29 are US.)

#### Scenario: Language and address come from one market

- GIVEN a member whose market resolves to `us`
- WHEN the generator input is built
- THEN the language equals `"en"` and the footer carries the US address

#### Scenario: LATAM is drafted in Spanish

- GIVEN a member whose market resolves to `latam`
- WHEN the generator input is built
- THEN the language equals `"es"` and the footer carries the LATAM address

#### Scenario: Unmapped market is held, not drafted

- GIVEN a member whose market resolves to `other`
- WHEN drafts are generated
- THEN no generator call is made, no draft is stored, and the member is held

### Requirement: Signals come from company data and are shown honestly

The signals passed to the generator MUST be derived from data the system holds for that Contact's company (open IT posting count, leadership flag, prior contact, notes), consistent with `extractOutreachSignals`. The "Señales usadas" chips in the review dialog MUST be derived from the same input handed to the generator, never parsed from model output.

#### Scenario: Chips reflect the prompt input

- GIVEN a member whose company has 1 open IT posting and who is a leadership role
- WHEN the review dialog opens
- THEN the chips include "1 vacante IT abierta" and "Cargo de liderazgo"
- AND no chip appears for a signal that was not in the generator input

#### Scenario: No signals still produces a draft

- GIVEN a member with no usable signals
- WHEN the draft is generated
- THEN a generic draft is stored and the chip list shows only the signals that exist

### Requirement: Generation failure is isolated

A generator failure for one member MUST NOT block, roll back, or alter drafts for other members. A failed member MUST stay without a draft and be retryable.

#### Scenario: One failure among ten

- GIVEN the generator errors for 1 of 10 members
- WHEN the batch finishes
- THEN 9 members have drafts
- AND the failed member shows no draft and can be regenerated individually

### Requirement: Edited drafts are never auto-regenerated

Once a BD has changed a draft's subject or body, the stored version MUST be treated as BD-owned. No batch action ("Generar borradores faltantes"), scheduled job, signal change, or reminder step MUST overwrite it. Only an explicit, one-to-one "Regenerar" action by the BD MAY replace it, and only after the server refused a first attempt and the BD confirmed losing that exact text: the server leaves an edited draft untouched unless the request carries the `editedAt` the BD was shown, and refuses again if the draft was edited after that instant.

#### Scenario: Missing-drafts batch skips edited drafts

- GIVEN a member with an edited draft and another member with no draft
- WHEN the BD uses "Generar borradores faltantes"
- THEN only the member without a draft is generated
- AND the edited draft is byte-identical afterward

#### Scenario: Explicit regenerate replaces the draft

- GIVEN a member with an edited draft
- WHEN the BD uses "Regenerar" on that member
- THEN the draft is replaced with a new generation
- AND the member's "reviewed" flag is cleared (see `sequence-approval`)

#### Scenario: Bulk regenerate is explicit

- GIVEN 3 selected members
- WHEN the BD uses "Regenerar los 3"
- THEN all 3 drafts are replaced and their reviewed flags are cleared

#### Scenario: Regenerating an approved member returns it to review

- GIVEN a member in `approved`
- WHEN the BD regenerates or edits their draft
- THEN the member returns to `drafted` and `approved_at` is cleared

### Requirement: Editing is allowed until send

A BD MUST be able to edit subject and body of any member in `drafted` or `approved` state, and "Guardar sin aprobar" MUST persist the edit without approving. A member in `sent`, `replied`, `no_reply`, or `discarded` MUST NOT have its sent content altered; the sent email MUST be viewable read-only ("Ver correo enviado").

#### Scenario: Save without approving

- GIVEN a member in `drafted`
- WHEN the BD edits the body and uses "Guardar sin aprobar"
- THEN the new body is stored and the state remains `drafted`

#### Scenario: Sent content is immutable

- GIVEN a member in `sent`
- WHEN the BD opens "Ver correo enviado"
- THEN the subject and body are read-only and match what was sent

### Requirement: Recipient and identity are shown, not editable

The review dialog MUST show the recipient address read-only and the sending address ("Desde ...") taken from the Sequence's referenced email account, and MUST state that the send is logged as an activity on the Contact.

#### Scenario: Review shows sender from the account row

- GIVEN a Sequence referencing an `email_account` whose address is `cristian@avalith.net`
- WHEN the review dialog opens
- THEN "Desde cristian@avalith.net" is shown
- AND that string comes from the account row, not from a constant in code

### Requirement: Reminder draft

The step 2 reminder MUST have its own draft (separate subject/body from step 1), generated automatically so it can be reviewed before it is due, and MUST follow the same edit-protection and regenerate rules as step 1. The reminder MUST reference the earlier outreach as a short nudge and MUST NOT invent new claims about Avalith or the recipient.

#### Scenario: Reminder draft exists before due date

- GIVEN a member whose step 1 was just sent
- WHEN the system finishes its post-send work
- THEN a reminder draft exists for that member

#### Scenario: Reminder draft edit is protected

- GIVEN the BD edited a reminder draft
- WHEN a later job runs
- THEN the edited reminder is unchanged
