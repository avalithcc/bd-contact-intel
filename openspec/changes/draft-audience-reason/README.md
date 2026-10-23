# draft-audience-reason — mockup

File: `mockups/idioma-y-direccion.html` (desktop only, shell of `generando.html`, stylesheet `crm-hubspot-ux/mockups/styles.css`, no new styles).

Shows, next to "Generar borrador", the language and legal address the draft will use and why
(`resolveComplianceAudience`, `src/lib/sequences/complianceAudience.ts`). Nothing is inferred; it only exposes the existing answer.

## Decisions the owner must approve

1. The block (flag, language, address, "por el país de ...") sits inside each contact card, above the actions.
2. Five reasons, each a separate row: own country (Mariano Loisotto), company country (Federico Biskupovich),
   company country with high volume (Globant, decides 103 contacts), postings bucket (Rodrigo Paz, invented example), HOLD (Galo Mosquera).
3. `[corregir]` is a menu: load the person's country, correct the company's country, load a phone.
4. HOLD disables "Generar borrador" and says what is missing.
5. Globant row carries a warning that correcting the company changes 103 contacts at once.
6. The postings bucket shows a globe, not a flag, because it names no country.

## Open question

**Sixth row (Alberto Nicolás Robledo, Com-Com):** the phone is the last link, so company "United States" plus a `+54` mobile gives
English/Miami today and the `+54` is never consulted. The row shows today's answer plus a quiet hint that the phone is not used.
The chain is NOT redesigned. **¿Mostramos este aviso, o lo dejamos afuera?**

## Measured numbers (production, 2026-10-23)

- 7,577 live emailable contacts
- 3,829 with no country of their own
- 1,777 of those decided by their company's country
- 442 companies contradicted by their own roster
- 357 contacts whose address or language comes from a contradicted company country

## Notes

- Names other than Mariano Loisotto, Federico Biskupovich, Galo Mosquera and Alberto Nicolás Robledo (Sofía Ledesma, Rodrigo Paz, Nodo Labs headline details) are invented placeholders.
- The shell's bulk "Aprobar los N listos" button is kept as in the shell; there is no "generar todos" button.
