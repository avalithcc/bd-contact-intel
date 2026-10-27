# audience-roster-consensus - mockup

File: `mockups/motivo-colegas.html` (desktop only). Same shell, cards and wording as the shipped and approved
`draft-audience-reason/mockups/idioma-y-direccion.html`; stylesheet `crm-hubspot-ux/mockups/styles.css` only, no new classes or colors.
The only inline styles are the ones the approved mockup (and `AudienceBlock.tsx`) already use for the card layout.

## Decision it illustrates

New precedence in `explainComplianceAudience`:

1. person country
2. **roster consensus**: the country held by a strict majority of the OTHER known contacts at the same company, at least 2 of them
3. company country (when the roster has no majority it is still used, with a visible warning; see the 2026-10-27 decision below)
4. phone dial code
5. postings market
6. HOLD

The card keeps its shape (flag, language, address, "por el país de ...", `corregir` menu). The reason line gains one reason and one note.

## Panels

| Panel | What it shows | Decision it illustrates |
|---|---|---|
| A. Consenso de colegas | Valentina Rojas, Despegar: "por el país de **12 colegas** en Despegar (Argentina)", the share ("12 de los 14") and a quiet line saying the filed company country (United States) is not used | A majority of colleagues beats the company field; the BD can see why the company field lost |
| B. País de la empresa | Federico Biskupovich, Lemon Cash (same as the approved mockup) plus one line: no colleague contradicts the company | Company country still works when nobody disagrees; the card says why it is trusted |
| C1. Colegas divididos, empresa con país | Camila Duarte, Rappi (company Colombia; colleagues Argentina (1) / México (1)): Español, Miami, "por el país de RAPPI (Colombia)" plus warn alert "Usamos el país de Rappi (Colombia), pero tus colegas no coinciden: Argentina (1) y México (1)." | A tie never picks a winner, but the company country keeps answering and the BD sees the disagreement; no new HOLDs (owner option A) |
| C2a. Colegas divididos, empresa sin país, cae al teléfono | Tomás Giménez, Nodo Labs: "Tus colegas en Nodo Labs están en 2 países" (Argentina (4) / México (4)), phone used | Only when the company has no country does a split roster reach the phone |
| C2b. Colegas divididos, empresa sin país, sin teléfono | Lucía Benítez, Nodo Labs: HOLD with the split in the explanation, button disabled, `corregir` menu | When nothing else answers, the BD is told to choose ("Elegí vos") |
| D. Antes y después: Globant | Sofía Ledesma side by side: today English/Miami by company country, new Spanish/Mar del Plata by "103 colegas" | The 357-style contradicted-company cases flip to the right language and address |

The table at the bottom lists the resolution order and what the card says at each step.

## Classes reused (all from `styles.css`)

`card`, `card-header`, `card-body`, `grid-2`, `stack`, `stack-sm`, `row`, `wrap`, `meta`, `strong`, `headline`, `mono`, `num`,
`badge` (`-outline`, `-verified`, `-danger`, `-info`, `-success`), `tag tag-scope`, `alert` (`-warn`, `-danger`), `dropdown`, `menu`
(`menu-label`, `menu-item`, `menu-sep`), `btn` (`-primary`, `-ghost`, `-sm`, `-icon`), `avatar`, `mock-note`, `table.data`,
`eyebrow`, `mt-2xl`, `mb-lg`.

## Notes for the owner

Resolved decisions (2026-10-27):

- `corregir` items are limited in the roster-consensus state: only "Cargar el país de {name}" and "Ver los colegas de {company}" remain. "Corregir el país de {company}" and "Cargar un teléfono" are hidden because they cannot change the answer there.
- `companyImpact` ("Esta empresa decide a N contactos") is removed from the component: it was only reachable when a colleague contradicted the company, and the roster now decides that case. It stays on the "Hoy" side of panel D for comparison only.
- Split roster (no strict majority) with a company country: the company country is still used, with the visible warning `companyDespiteSplit` ("Usamos el país de {company} ({filed}), pero tus colegas no coinciden: {breakdown}."). No new HOLDs. The earlier sentence "Tampoco usamos el país de la empresa ({filed}) porque lo contradicen." is dropped. Approved by the owner 2026-10-27, option A. A split roster reaches the phone or HOLD only when the company has no country.
- The `unusedPhone` hint is NOT shown in the roster-consensus state: the phone cannot change the answer there (same rule as the hidden items).

- The "idioma" menu (language override) shown by the real component when the viewer can edit is not drawn, as in the approved mockup.
- Names and numbers in panels A, C and D are invented placeholders (Valentina Rojas, Tomás Giménez, Lucía Benítez, Despegar, Nodo Labs, 12 of 14, 4 + 4, 103 of 110, 41). Federico Biskupovich / Lemon Cash comes from the approved mockup. The "103 colegas" figure is a count of colleagues WITH a country; it must be re-measured against production before it is quoted anywhere.
- The count shown is the size of the winning group; the denominator is the colleagues with a known country. Colleagues without a country do not count either way.
- Phone-case copy "Por eso se miró el teléfono" is only shown when the roster was split and the phone then answered.
- Internal CRM copy is voseo (owner rule); the prospect-facing draft is unaffected.

## Approved: 2026-10-27 by the owner, with corregir items limited in the roster state and companyImpact removed
