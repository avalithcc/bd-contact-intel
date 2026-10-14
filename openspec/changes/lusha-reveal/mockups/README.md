# lusha-reveal — mockup

Design-only. No application code changed. Open `lusha-reveal.html` in a browser (desktop only, checked at 1280px and 1024px with no horizontal scroll). It links the shared `../../crm-hubspot-ux/mockups/styles.css` and draws the "Sobre este contacto" pane (`PropertyList`) with the Lusha reveal control.

**Decision needed (gate 0.3):** approve the 10 states below. The three earlier open questions were answered by the owner and applied (see Decisions applied). Approval date: _pending_.

## States

| # | State | Requirement it expresses |
|---|-------|--------------------------|
| 1 | Pane, email and phone empty, each with its own priced control (~2 and ~6 credits) | reveal-action: per field, visibly Lusha, first attempt shows search-inclusive price (D16) |
| 2 | Dialog 1, cost (email, and phone variant) | reveal-action: confirm first, separate dialogs; credit-cap: remaining shown in dialog (D2) |
| 3 | Dialog 2, matched identity, real probe case `Aument / aument.io` vs `Aumenta GT / www.aumenta.do`, with a neutral "Distinto" column | identity-match: shown before the reveal charge, reject offered, 3-button footer |
| 4 | Revealed email and phone with the Lusha badge, plus the phone price dialog reusing the stored identity | reveal-action: branding stays after reveal; identity-match: reused match not re-confirmed |
| 5 | "Lusha no tiene correo": no automatic offer, reason visible, explicit "Buscar de nuevo · 1 crédito"; phone still offered | error-handling: `NOT_FOUND` / `no_value` (D6: manually retryable) |
| 6 | Match rejected: callout plus "Buscar de nuevo · 1 crédito", and its dialog | identity-match: explicit re-search, new credit, no auto retry (D5, D6) |
| 7 | Cap exhausted: disabled control with the limit and reset, plus the server refusal inside an open dialog | credit-cap: copy distinct from 402 |
| 8 | Duplicate email: toast, persistent warning on the row, link to the other contact, no merge button | duplicate-email (D12) |
| 9 | Errors: 402 (account without credits), 429 (rate limit, nothing charged), 451 (permanent, blocks the whole person: no reveal action on either field) | error-handling |
| 10 | Missing `LUSHA_API_KEY`: disabled control, names the variable only (extra, from task M.1) | D13 |

Not drawn: 401 and 403 copy, the "both phone columns occupied" dialog (D11), the merged-away refusal, the not-production state (nothing renders). They add no new layout.

## Design-system usage

Reused from `styles.css`: `.record-left`, `.record-identity`, `.props/.prop/.hint/.why/.derived`, `.btn-secondary/.btn-primary/.btn-ghost/.btn-sm`, `.badge-outline.no-dot` (the Lusha badge, D16), `.badge-contacted`, `.locked` (used as a callout under a row, never as a button state), `.alert-warn/.alert-danger`, `.toast.inline`, `.dialog`, `.dialog.wide`, `.dialog-footer .left`, `table.data.compact`, `.mock-note`, `.tag`.

Local `<style>` block (mockup scaffolding only, none proposed for the app): `.stage` (copied from reports-kpi-drilldown), `.case`, `.pane`, `.captions`, `.mb-md` (exists in the app's `globals.css`), and two cosmetic rules for row headers and numeric cells inside dialog tables. No new color, no new component class is needed for the app, as the plan requires.

Traps respected: `.locked` is a callout; the three-button footer sits in `.dialog.wide` (the 520px dialog footer only holds two); no `.meta` on a dark bar.

## Copy

The dictionaries have no Lusha strings yet. Reused wording: "Correo electrónico", "Teléfono", "Móvil", "Cancelar", "Cerrar", "Verificado/Deducido" placement, hint-line style. All new copy is neutral Spanish (no voseo) and will go through `es`/`en` in PR 6.

## Decisions applied (owner answers)

1. **Uniform retry rule.** The three non-permanent outcomes (no match, no value, match rejected) never retry or offer a spend automatically, and always keep an explicit "Buscar de nuevo · 1 crédito". Reason: the usual cause is wrong data on our side (company domain), and once corrected the contact must not stay trapped. Only 451 / `COMPLIANCE_RESTRICTED` is permanent. States 5 and 6 draw this; the spec file is being aligned by the coordinator.
2. **Differences are marked.** The identity dialogs add a "Comparación" column from a plain normalised string compare (lowercase, strip `www.`, strip diacritics): neutral `badge-neutral` "Distinto", or "Igual". Raw values stay visible and unmodified. It is a diff, not a confidence score and never an error tone. A same-organisation variant (`mercadolibre.com` vs `careers-meli.mercadolibre.com`, state 4) is also marked "Distinto": informative, never blocking. Accents are normalised away, so `Julián` vs `Julian` reads as "Igual": a marker that fires on noise trains BDs to ignore it, and then it stops catching the case that matters.
3. **Phone control and 451.** One phone control on "Teléfono" only (Lusha picks the column, D11). A 451 blocks the whole contact: after it the pane offers no reveal action for email or phone (state 9c).

Smaller decisions taken: the revealed email shows only the Lusha badge (the model stores it as `probable`, which has no badge today); the cap reset is stated as "mañana" (Argentina time, per spec); the pane shows no app shell (sidebar, topbar).

Local CSS also includes wrapping and padding rules for the comparison tables so they fit at 1024px.
