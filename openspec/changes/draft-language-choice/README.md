# draft-language-choice — mockup

File: `mockups/elegir-idioma.html` (desktop only, shell of `idioma-y-direccion.html`, stylesheet
`crm-hubspot-ux/mockups/styles.css`, no new classes or styles).

Owner request: "la opcion previa a generar el mensaje y que pregunte el idioma de la redaccion seria optimo".
"Generar borrador" opens a confirmation dialog (same `Dialog` shape as `RegenerateConfirmDialog`: header, body, Cancelar + primary action)
that shows the resolved language with its reason, preselected, and lets the BD override it.

## Decisions the owner must approve

1. **A dialog on every "Generar borrador"** (and on "Regenerar"), even when the resolution is right (state 2). Cost: one extra click in the common case.
   Alternative: keep one click and put "Cambiar el idioma" in the card menu only. The request says "que pregunte", so the mockup asks every time.
2. **Only español and inglés.** No Portuguese: Brazilian contacts receive English (owner decision). `AudienceLanguage` is `"es" | "en"`.
3. **The address is shown as FIXED**, with the line "elegir otro idioma no la cambia". It is never a control.
   `buildFooter(config, address, language, url)` already takes them separately (`config.ts:11`).
4. **The opt-out sentence follows the chosen language** (footer preview in the dialog), so the recipient can read how to unsubscribe.
   The preview is prospect-facing, so it is neutral Spanish ("Si prefieres"), never voseo.
5. **The choice is remembered per contact.** Regenerating reuses it. The card then shows "elegido por una persona", who and when,
   and what it would have been ("Sin esa elección sería inglés"). The card menu has "Volver al idioma resuelto".
6. **A US contact (Brian Casteel, invented example)**: English is preselected and "recomendado"; Spanish is a muted option with a warning.
7. **HOLD (Galo Mosquera) is untouched**: no dialog, no language menu. A language cannot unblock a missing postal address.
8. **One at a time, no bulk.** The dialog has a single primary action and says the screen locks while generating (PR #399).
   There is no "generar todos" and no "generar en español para todos".

## The one real tension: `draftInput.ts`

`SequenceDraftInputArgs = Omit<BuildPersonMessageInputArgs, "language" | "channel">`, and the header says "the language is never a caller choice".
That is deliberate: it makes it impossible for any caller (a bug, a refactor, a script) to draft a US contact in Spanish by accident.

This design keeps that protection. The language stays **non-choosable by code**: `buildSequenceDraftInput` still takes no `language` argument and
`tests/unit/sequencesDraftLanguageGuard.test.ts` keeps failing the build if anything else reaches the generator. What changes is the *source* of the value:
the language becomes choosable only by an **explicit, recorded human act**.

For that to hold, these things would have to change when it is built:

- The override is **stored per sequence member** (value, who, when), not passed as a parameter by whoever calls the generator.
- The audience resolver (`complianceAudience.ts` / its caller) reads that stored override and returns it as the audience's `language`.
  `buildSequenceDraftInput` keeps reading `audience.language` and nothing else, so its signature and the `Omit` type do not change.
- Only the dialog's server action may write the override, and only with `"es" | "en"` validated server side. The address is never part of that write.
- Regeneration reads the stored value, so it cannot silently revert to the resolved one.
- The header comment of `draftInput.ts` must be reworded: "never a caller choice" becomes "never a caller argument; it is the audience's field, which a person may override per member".

## Not covered by the brief (decided in the mockup, needs a yes or no)

- "Volver al idioma resuelto" in the card menu (the undo of an override).
- Card shows the chooser's name and time ("Cristian Civita el 23 oct, 14:12").
- If the contact's country is later corrected, the stored override **wins** over the new resolution until the BD clears it. Alternative: clear it on a country change.
- The Spanish warning in state 3 is always visible, not only after selecting it.
- Cards use a plain `<p>` for the job title, because `.headline` is not defined in `styles.css` (the approved mockup uses it anyway).
- The flag next to the chosen language is the language's country flag (🇦🇷 for español), not the resolved country, to avoid implying a location.

## Class verification

77 distinct classes used, 0 missing from `crm-hubspot-ux/mockups/styles.css` (checked with a script against every `class=` value).
`.dialog.static` (existing) is used to show four states on one page without overlays.
