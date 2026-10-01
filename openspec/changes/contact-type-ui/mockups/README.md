# contact-type-ui — mockups

Mockup-only proposal. No application code changes. The owner approves these
before any implementation.

`person.contact_type` (migration 0034) holds the hotel sheet's "TYPE OF
CONTACT": `BUYER-CHAMPION` or `INFLUENCER`. The reason it exists is so Mariel
can decide **who to call first** among her new contacts. Today it has no UI.

## The problem: 147 of 27,773 contacts have a value

For 99.5 % of the book the field is NULL. Every other import (LinkedIn, HubSpot,
fi-arg-2026, dff-2026) leaves it empty. Two failure modes to avoid: a column
that is blank on 27,626 rows, and a loud badge on 147 rows against a sea of
nothing.

**Answer: treat it as a quiet attribute, not a status.** Plain text, an em dash
when empty, column off by default, and the weight of the feature carried by the
*filter*, not by the column.

## Files

| File | Shows |
| --- | --- |
| `contacts.html` | Column ON, with a realistic mix: hotel rows with a value among rows without |
| `contacts-filter-menu.html` | "Agregar filtro" open, with "Tipo de contacto" in the main group |
| `contacts-column-picker.html` | "Columnas" open, with the new entry |
| `contact-record.html` | "Sobre este contacto" with the value |
| `contact-record-empty.html` | Same panel without a value (the 99.5 % case) |

The three list files are the same page in three states (the two menus would
cover the table if shown together). Links to unchanged screens point into
`../../crm-hubspot-ux/mockups/`. `styles.css` is an unmodified copy.

## Decisions

### 1. Badge or plain text? Plain text.

Precedents in the list today:

- `roleGroup` renders as plain text (`nowrap soft`). It is a *classification of
  the person*.
- `status` renders as a coloured badge. It is a *derived workflow state* with
  semantic colour (replied, meeting, discarded), computed from activity.

`contact_type` is a classification, like `roleGroup`. A coloured badge would
imply a state or severity that does not exist, and 147 loud badges among 16,000+
blank rows reads as a rendering bug. Plain text still stands out because it is
the only non-empty cell in the column. The "who first" signal comes from
filtering to the two values, not from colour.

Considered and rejected: a green badge for `Comprador / promotor` only. It would
rank the two values in the UI, which is a product claim the data model does not
make (it is a closed set of two labels from a sheet, not a priority score).

### 2. Empty cell: an em dash `—`, not `badge badge-none`.

`badge-none` ("Sin correo", "Sin teléfono") is used where absence is a **work
item**: a BD can go and find the email. Absence of a contact type is the normal
state of 99.5 % of rows, and nobody should be asked to fill it in. Repeating a
bordered "sin dato" pill 27,626 times is noise. The em dash is what the app
already uses for empty `roleGroup`, `industry`, `country`, `source` (`ownerNone`)
and for the empty "Última actividad" cell. The record page uses the same
`emptyValue` dash.

### 3. Column default: OFF in the picker.

Only someone working this subset needs it. On for everyone it would add a mostly
blank column to every BD's list. It is addable in two clicks, and it persists in
a saved view (the existing mechanism), so Mariel can keep a "Hoteles nuevos, sin
contactar" view with the column on.

Position: after "Estado", in both the picker and the table. Reason: the table
already scrolls horizontally inside `.table-wrap` (1691 px of content in 1158 px
at a 1440 px window). A column appended at the end is outside the fold, which
defeats the point. Next to "Estado" it sits with the other attributes that drive
who to contact. The BD can still drag it elsewhere (existing behaviour).

### 4. Filter placement: the MAIN "Agregar filtro" group, after "Grupo de rol".

`FILTER_MENU_ORDER` is the mockup's own menu. `EXTRA_FILTER_MENU_ORDER`
(`industryGroup`, `seniority`) is a legacy overflow kept so nothing that used to
be reachable disappeared; it is not a statement about importance. Because the
column is off by default, the filter is the primary way to use this field, so
burying it in the overflow would make the feature undiscoverable. It is a select
(closed set of two), like `roleGroup` and `emailStatus`. Cost: one more item in a
menu that goes from 11 to 12 entries.

The inline editor after clicking the item is the existing select editor
(`.menu.left` with a `.select`), already used for `roleGroup`; it is not redrawn
here. Options: `Cualquiera`, the two labels, and, to answer "who has no type",
`Sin tipo` (flagged under "Open questions").

## Spanish labels (stored values untouched)

| Stored value | UI label |
| --- | --- |
| `BUYER-CHAMPION` | Comprador / promotor |
| `INFLUENCER` | Influenciador |
| `NULL` | `—` (column, record) / `Sin tipo` (filter option only) |
| field name | Tipo de contacto |

Sources: `GLOSSARY.md` has no entry for these terms. The `bd-playbook` mockups
already settle "comprador" and "influenciador" (e.g. "es influenciador técnico,
no comprador"), so I reuse them. "Champion" has no clean Spanish noun in B2B
sales; "promotor" (internal advocate) is the closest, kept next to "comprador"
because the stored value fuses both roles. Proposed glossary addition:
`Contact type | Tipo de contacto`.

## Record page

"Tipo de contacto" is a normal `.prop` row after "Grupo de rol", with the
standard hover pencil. With value: `Comprador / promotor`. Without: `—`. As in
HubSpot, a single-select property shows in About and is editable in place. The
editor (select with the two values and an empty option) is not drawn: it follows
the existing inline-edit pattern, with a `.select` instead of an `.input`.

## New classes or tokens

None. Every class is already in `styles.css` (`badge-none`, `menu-item`,
`check`, `prop`, `soft`, `nowrap`, `chip`, ...). The tag icon on the new filter
item is the same Lucide `tag` path style as the other menu icons.

## What I deliberately did NOT do

- No code under `src/`, no server action, no query, no migration.
- No colour or badge for the values (see 1).
- No sort-by-column design. Sorting the list so typed contacts come first would
  help "who first" even more, but the list has no per-column sort pattern in the
  mockups yet. That is a separate decision.
- No new saved system view (e.g. "Hoteles por llamar"). Mariel can save her own.
- No bulk "set contact type" action. Out of scope, and the values come from the
  sheet.
- No filter for the 147 as a count chip or badge in the tabs.

## Placeholders in the mockup

Hotel names, people and "Mariel Gómez" as owner are invented placeholders, not
real data. Rows were changed from the original mockup: some are hotel contacts,
so the "Grupo de rol" filter chip was dropped from this copy (hotel rows are not
in an engineering role group) and the saved-view dialog was adjusted to match.

## Open questions for the owner

1. Filter options: include `Sin tipo`? (Useful to find who still needs
   classifying; adds a null-matching query path.)
2. Label wording: `Comprador / promotor` vs `Comprador-promotor`.
3. Is plain text enough, or do you want the two values visually distinguished?

## How it was checked

Opened each file in headless Chromium (Playwright) at 1440 px: no page errors,
screenshots reviewed. The only horizontal overflow is the table inside
`.table-wrap`, as in the original mockup.
