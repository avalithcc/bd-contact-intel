# contact-whatsapp-access

Status: **mockup only, nothing approved.** No proposal, spec, design or tasks exist for this change on purpose: the point is to argue over something concrete before deciding anything.

Open `mockups/phone-whatsapp.html` straight from the filesystem. It is self-contained (the shared `styles.css` of `crm-hubspot-ux` is inlined, no fonts or scripts are fetched). The UI copy is Spanish, like the other mockups.

## What is being decided

How a BD gets from a phone number to a WhatsApp chat. The owner's description of the workflow: most numbers are mobiles, and the BD either calls the number or, failing that, goes looking (outside the CRM) for whether it is on WhatsApp and can be reached there.

The mockup draws a WhatsApp affordance next to the phone, in the contacts list and on the contact record, and a way to present Teléfono and Móvil as one field on the record without merging the columns.

## The honesty rule

The CRM cannot know whether a number has WhatsApp. `https://wa.me/<digits>` opens for any number and WhatsApp itself reports whether it is registered. So no variant shows a check mark, a "has WhatsApp" badge or any state we cannot compute. The control says "Abrir WhatsApp con este número" and nothing more. Links in the mockup point to `#` so nobody messages a sample number by accident.

## Variants

| | Behaviour | Main cost |
|---|---|---|
| **A. Always available** | Every valid number with a country code gets the shortcut. | Landlines get a shortcut that probably leads nowhere; one extra icon per row. |
| **B. Plausible mobiles only** | The shortcut shows only when the number looks like a mobile; landlines show the call link alone. | Needs a classifier (no phone library exists in the repo). Mexico, the US and Canada cannot be told apart, so a strict rule loses contacts. The column stops being uniform. |
| **C. Number menu** (own proposal) | The number stays a `tel:` link; a "⋯" button opens a menu: Llamar, Abrir WhatsApp con este número, Copiar número. For two numbers the menu lists both. | WhatsApp costs two clicks instead of one. A dropdown inside a table cell is clipped by `.table-wrap` (`overflow-x: auto`) near the end of the list. Needs an accessible menu. |

States drawn in every variant, in both the list and the record: mobile, fixed line, two different numbers, Mexican number (fixed or mobile, indistinguishable), long international number, fixed line with extension, valid number without country code, malformed number (plain text, as the app renders it today), and "Sin teléfono".

The glyph is an inline monochrome SVG. A comparison block also shows WhatsApp green (`#25D366`, about 2:1 on white) and a dark green (`#128C7E`, about 4.1:1). Green is the design system's success colour, so next to a number it could read as "verified".

## One "Teléfono" field, two stored values

Merging `phone` and `mobilePhone` in the database would destroy the second number of 101 contacts. The compromise drawn: the record shows one "Teléfono" row computed at read time. One value shows as one line with no label; two different values show as two lines labelled "Móvil" (first) and "Otro". Editing opens one dialog with both fields. Nothing in the schema changes.

## Measured data

Of 27,685 contacts, 3,934 have any number:

| Stored | Contacts |
|---|---|
| only `phone` | 2,509 |
| only `mobilePhone` | 1,315 |
| both, identical | 9 |
| both, genuinely different | 101 |
| no number | 23,751 |

97% of the contacts that have a number have exactly one. The design is built for the one-number case; two numbers are the exception.

## Facts about the current app that shape the options

- `src/lib/phone.ts` stores numbers as typed. `011 4123-4567` is valid, and without a country code no `wa.me` link can be built without guessing the country.
- The same validator rejects letters, so a number with an extension such as `... int. 214` is malformed today and renders as plain text. The extension state in the mockup is a proposal.
- `pickListPhone` shows `phone` before `mobilePhone`. For the 101 two-number contacts the list shows the landline-side value first; the mockup draws the mobile first.
- There is no phone-parsing library in `package.json`.

## Open questions

1. A, B or C? If B, what is done with ambiguous numbers (MX, US, CA) and with countries that have no rule? The share of the 3,934 numbers in those countries has not been measured.
2. Numbers without a country code: assume a default country, or no shortcut?
3. Should the list show the mobile before the landline?
4. Are extensions supported (stripped from the WhatsApp link, kept in the display)?
5. Should opening WhatsApp log anything? Status is derived from logged activity, and a link click does not prove a message was sent.
6. Record labels "Móvil" / "Otro" and a single edit dialog, or a pencil per line?
7. Monochrome glyph or brand green?
