# preferred-language — mockup

File: `idioma-preferido.html` (desktop only, shell of `elegir-idioma.html`, stylesheet
`crm-hubspot-ux/mockups/styles.css`, no new classes, no new colors, no inline styles beyond the ones the approved
mockups already use).

Owner-approved feature (2026-10-27), HubSpot "Preferred language" pattern: a contact property **Idioma preferido**
(Español / Inglés / empty shown as "Automático"). When set it wins over every other source for the **language** of the
outreach draft. It never touches the legal address (that still comes from where the recipient is, CAN-SPAM) and it never
unblocks a HOLD. Empty means today's automatic resolution (person country, colleagues, company, phone, postings).

Built from the approved designs, reused as-is: `draft-language-choice/mockups/elegir-idioma.html` (dialog, card after
choosing), `draft-audience-reason/mockups/idioma-y-direccion.html` and `audience-roster-consensus/mockups/motivo-colegas.html`
(audience card and reason lines), and the real `.prop` rows of `PropertyList.tsx` / `contact-record-admin.html`.

## Panels

### A. Contact record, properties pane (A1 empty, A2 set, A3 edit open)

- Same `.prop` row as the rest: `dt` label, `dd` value, pencil `.edit` button (`aria-label="Editar"`), `dd.hint` line.
  Placed right after "Ubicación" because it is the property that interacts with it.
- A1: value "Automático" (`dd.soft`) and a hint saying what happens when empty.
- A2: value "Español" and hint "Cargado por Mariel Sosa el 27 oct" (who and when).
  The data already exists: the property is written through `updateContactPropertyAction`, so `person_property_history`
  records the actor and time; the hint is the same slot as `lastUpdatedLabel` today.
- A3: inline edit with `.select` (Automático / Español / Inglés) plus Guardar / Cancelar, the same pattern as Responsable and
  Tipo de contacto. Choosing "Automático" clears it. Every change shows up under "Historial".
- Rule shown: the property is data of the person, editable by any BD, audited with the actor.

### B. Language dialog with the new checkbox (B1, B2, B3)

- The approved dialog, plus one `label.check` checkbox under the language radios and its `.help` line.
- B1, no preference stored, BD picks a language different from the resolved one: checkbox **checked** (proposal, see decision 1).
  The info alert changes with the checkbox: checked says it is saved as preferred for all sequences; unchecked says it
  stays only in this sequence (the existing wording).
- B2, preference stored, dialog opens on it with badge "idioma preferido" and its reason; selection equals the stored
  value, so there is nothing to save and **the checkbox is not shown**.
- B3, preference stored, BD picks the other language: checkbox shown **unchecked** (replacing someone else's explicit
  value must be an explicit act) with a help line naming the current value, who and when.
- The address card stays "fija" and the footer preview follows the selected language, as approved.
- Rule shown: the checkbox only exists when there is something to save.

### C. Audience card with the "idioma preferido" reason (C1, C2, C3)

- Same card as `draft-audience-reason`. The language row gets `badge badge-info` "idioma preferido" (same badge the
  "elegido por una persona" case uses) and the reason line is split: the language reason, then "Dirección:" with its own,
  unchanged reason (`addressNote` already exists).
- C1: Federico, español preferido, address Miami "por el país de LEMON CASH". Language and address have different reasons.
- C2: Mariano (Argentina), inglés preferido, address stays Mar del Plata "por el país de Mariano": the inverse case.
- C3: Galo, preferred language set but no location: still "En espera". A language cannot create an address.
- "idioma" menu with a preferred language: "Cambiar el idioma" (opens the dialog, one-off) and
  "Cambiar el idioma preferido en la ficha" (link to the record). "Volver al idioma resuelto" is not offered here
  because there is no per-draft choice to undo. "corregir" keeps fixing the country (the address).

### D. One-off override not saved, existing wording (D1, D2)

- Exactly the approved card after choosing: "elegido por una persona", "idioma elegido por X el 27 oct, 14:12. Sin esa
  elección sería inglés." and the menu item "Volver al idioma resuelto (inglés)".
- D2 shows the preference-set case: the "sin esa elección" part names the preferred language (español).
- Rule shown: a one-off choice beats the preference for that draft only and writes nothing on the contact.

### Precedence table (bottom of the page)

1. One-off choice in the dialog (existing, per sequence member). 2. Idioma preferido (new). 3. Automatic resolution.
A second table states what the preference does **not** change: address, opt-out sentence (follows the language),
HOLD, Portuguese (does not exist).

## Classes reused (all in `styles.css`, verified with a script against every `class=`)

`dialog.static`, `dialog-header/body/footer`, `fieldset`, `field`, `label`, `check`, `help`, `select`, `alert-info`,
`alert-success`, `alert-danger`, `badge-info/-success/-outline/-warn/-verified/-danger/-discarded`, `tag-scope`,
`props`, `prop`, `hint`, `soft`, `edit`, `section-title`, `card`, `grid-2`, `grid-3`, `dropdown`, `menu`, `data`.

## Spanish strings proposed (es dictionary)

Internal CRM copy is voseo; the footer preview stays neutral Spanish (prospect-facing, unchanged).

Contact record (contact property labels):

| key (suggested) | text |
| --- | --- |
| `propPreferredLanguage` | Idioma preferido |
| `preferredLanguageAuto` | Automático |
| `preferredLanguageEs` | Español |
| `preferredLanguageEn` | Inglés |
| `preferredLanguageAutoHint` | Sin idioma preferido: el idioma de los borradores se decide por el país, en este orden: la persona, sus colegas, la empresa, el teléfono. |
| `preferredLanguageSetBy` | Cargado por {name} el {when} |
| `preferredLanguageEditHint` | Solo cambia el idioma del borrador. La dirección legal sigue saliendo de dónde está el contacto. "Automático" borra la preferencia. |

Language dialog (`languageChoice`):

| key (suggested) | text |
| --- | --- |
| `savePreferred` | Guardar como idioma preferido de {name} |
| `savePreferredHelp` | Se carga en su ficha, gana sobre el país y lo podés cambiar o borrar cuando quieras. |
| `savePreferredReplaces` | Hoy su idioma preferido es {lang} (cargado por {by} el {when}). Si lo guardás, lo reemplaza. |
| `changingAfterPreferred` | Queda guardado como idioma preferido de {name}: vale para todas sus secuencias, no solo para esta. |
| `badgePreferred` | idioma preferido |
| `preferredReason` | idioma preferido de {name} (cargado por {by} el {when}) |

Existing strings reused unchanged: `badgeResolved`, `badgeChosen` ("elegido por vos"), `okStrong`, `okRest`,
`changingBefore`, `changingAfter` (unchecked case, B3), `addressNote`, `chosenBadge`, `chosenBy`, `chosenOn`, `menuChange`,
`menuReset`, `menuTrigger`, `menuLabel`, `menuAria`, plus the whole address and footer block.

Audience card (`audience`):

| key (suggested) | text |
| --- | --- |
| `preferredBy` | idioma preferido de {name} (cargado por {by} el {when}). Sin esa preferencia sería {resolved}. |
| `menuPreferredInRecord` | Cambiar el idioma preferido en la ficha |
| `holdPreferredNote` | Su idioma preferido es {lang}, pero el idioma no resuelve la dirección. |

## Decisions the owner must approve

1. **Checkbox default.** Proposal: tildada cuando no hay idioma preferido cargado (B1; the point of the feature is that the choice
   stops being lost per sequence member), sin tildar cuando guardarla reemplazaría un valor que ya existe (B3), and not shown
   when the selection equals the stored value (B2). Risk of default-checked: a quick one-off choice becomes durable and "wins over
   everything" without the BD noticing; mitigated by the help line, the Automático option and the Historial. Alternative: always
   unchecked (safer, but the choice keeps getting lost, which is what this feature fixes).
2. **Correcting the contact's own country later.** HubSpot keeps explicit properties, so the proposal is that the preferred
   language **keeps winning** after the country changes (it is an explicit human statement, not a derived value). Alternative:
   clear it on a country change, which would silently discard a deliberate choice.
3. **Wording of the "who and when" line.** The mockup uses "Cargado por Mariel Sosa el 27 oct" as asked. The record already has a
   generic line, "Última actualización por Mariel Sosa · 27 oct", fed by the same history. Reusing it costs nothing, but says
   "last updated" rather than "set by" if it is edited twice. Pick one wording.
4. **A one-off choice beats the preference for that draft** (precedence 1 over 2). Proposal: yes, because it is the BD's explicit,
   most recent act on that draft and it matches the approved per-member override. Alternative: the preference always wins and
   the dialog would have to save it.
5. **Not shown, on purpose:** what "Automático" would resolve to today ("hoy sería inglés, por el país de LEMON CASH") in the
   record. It would need the audience resolution (company and colleague reads) on every record view. Say if you want it.
6. **Who can edit it:** any BD, with the actor logged in Historial, as for the other contact properties (no admin gate).

## Not covered

Bulk set from the contacts list, import of the property, and a filter or column for it. Out of scope for this slice.

Approved:
