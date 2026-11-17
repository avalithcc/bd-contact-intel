# audience-controls-alignment — mockup

Design-only proposal. No application code changed. Static HTML at
`alineacion-controles.html`, built on the approved `crm-hubspot-ux` shell
and on the approved `draft-audience-reason/mockups/idioma-y-direccion.html`,
whose card this redraws.

Open it in a browser. The top half ("Hoy") reproduces what the owner
screenshotted on 2026-11-17; the bottom half is the proposal, in four
states.

## What was wrong

The owner reported that the "idioma" control was not aligned with the red
"Generar borrador" button. Two separate defects, both measurable against
the approved mockup:

1. **`align-items: flex-start` was lost.** `.row` centres its children
   (`design-system.css:74`), and the approved mockup overrides that on the
   card body. The implementation does not, so the action column floats to
   the vertical middle of a taller card.
2. **A row designed for one control ended up with two.**
   `draft-audience-reason` drew a single `corregir` dropdown in a
   `justify-content: space-between` row beside the reason. The `idioma`
   dropdown was added into that same row by a later change
   (`draft-language-choice`), and nobody re-drew it for two. With two
   controls the group's left edge moves, so no card lines up with the next.

## Decisions

### 1. The language is edited where it is read — and with no popup

The word beside the flag becomes a **`segmented`** control: `Español |
Inglés`. That is the component this design system already uses for the
Tabla / Tablero switch in Contacts, and it suits a two-option choice.

The first attempt used a dropdown menu. The owner rejected it: a popup
over the card for two options is not this system's pattern. Correct — and
the component was already there.

Capitalised, `Español` / `Inglés`, not the lowercase of today.

**Two options is right for this screen and not an accident:**
`AudienceLanguage = Extract<MessageLanguage, "es" | "en">`, with the
comment "pt is never emitted here". The wider system has three
(`MESSAGE_LANGUAGES = ["es", "en", "pt"]`, owner direction 2026-09-26), but
Portuguese never reaches a sequence — plausibly because the footer carries
a postal address and there is no Brazilian entity. A segmented control
takes a third option later without redesign, so this does not paint us in.

### 2. `corregir` is replaced by the data it corrected

It was a verb with no visible object: what it corrected — the country —
appeared only buried in the reason sentence. Now the card shows

> **País:** Chile ✎  ·  Flybondi: Argentina ↗

directly under the role, and the person's own country is editable there.

This is new capability. Today `corregir` only *navigates* to the contact or
company record; nothing is edited inline.

### 3. The COMPANY's country stays read-only here

The person's country affects their own drafts. The company's country
changes the audience for **every** contact at that company — the approved
mockup already warns "esta empresa decide a 103 contactos". That warning
lives on the company record, so the company is shown as a value with a link
to it, and only the person's own country is editable from the card.

Making it editable here is possible, but it would have to bring the
blast-radius warning with it. That is a separate change.

### 4. Changing the country never rewrites an existing draft

**Owner decision:** warn, and leave the draft exactly as it is.

The country decides language and address, so changing it leaves an already
generated draft out of date. Rewriting it automatically would delete text
the BD may have read and adjusted. The card says what changed, shows what
would now apply, and offers "Regenerar" — it never regenerates by itself.

The fourth card shows this state.

## What this does not touch

The language dialog stays. It is asked before every generation and
regeneration, and it also shows the fixed postal address (CAN-SPAM),
previews the footer with the same `buildFooter` the send uses, and offers
to save the language as the contact's preferred one. The segmented control
is a correction to this draft, not that question.

**Desktop only, by owner direction.**
