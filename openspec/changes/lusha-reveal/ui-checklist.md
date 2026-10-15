# lusha-reveal PR 6: mockup checklist

Source: `mockups/lusha-reveal.html` (10 states, approved 2026-10-14). Evidence is `file:line` in the working tree at commit time.
Paths: `LR` = `src/app/(app)/contacts/[id]/LushaReveal.tsx`, `RV` = `src/lib/lusha/revealView.ts`, `PL` = `src/app/(app)/contacts/[id]/PropertyList.tsx`.

| # | State / element | Status | Evidence | Notes |
|---|-----------------|--------|----------|-------|
| 1 | Priced control per row (~2 / ~6), Lusha badge, "gasta créditos reales" hint | done | RV `ESTIMATED_FIELD_PRICE`, LR `label`, `lushaHintSearch` | Estimate is labelled "~"; real price comes from the search's canReveal afterwards |
| 1 | Phone control on "Teléfono" only, none on "Móvil" | done | LR `isOwnRow`, PL `<LushaRow` | |
| 2 | Cost dialog (email, phone), table, total "hasta N", remaining today, Cancelar / Buscar · 1 crédito | done | LR `costDialog` | |
| 3 | Identity dialog: alert, CRM vs Lusha table with Distinto/Igual, cost line, remaining + stale balance, 3-button footer | done | LR `identityDialog`, `src/lib/contacts/identityDiff.ts` | Balance fetched on open, never blocking |
| 4 | Lusha badge beside revealed email/phone, "revelado por X, fecha" hint | done | LR `lushaBadgeFor`, `revealed` hint; phone column derived from the ledger value | |
| 4 | Phone price dialog reusing the stored identity (no reject button) | done | LR `f.confirmed` | |
| 5 | "Lusha no tiene correo": callout above, "Buscar de nuevo · 1 crédito", "mismo dato" hint, phone still offered | done | RV `unavailable`, LR `notice` | |
| 6 | Rejected: callout naming the match, "Buscar de nuevo", research dialog with domain tip | done | RV `rejected`, LR `c.kind === "research"` | |
| 7 | Cap exhausted: disabled priced control + reason below; server refusal inside an open dialog | done | RV `capped`, LR `noteLast`, `alert()` | Reason text is the email-row version on both rows (mockup shortens it on the phone row): deviation, copy only |
| 8 | Duplicate email: toast with "Ver contacto", persistent row warning linking to the other Contact | done | LR `announce`, `dd.why`; ledger read `twin` in `getRevealState` | No merge button, as drawn |
| 9a/9b/9c | 402, 429 (with "Reintentar búsqueda"), 451 (no action on either field) | done | LR `alert()`, `TITLE`, RV `blocked` | |
| 10 | Missing key: disabled unpriced control + variable name only; nothing outside production | done | RV `unconfigured`, `off` | |
| - | Phone-held warning (PR 5 review) in both spend dialogs | done | LR `heldWarning`, RV `holdsPhone` | Not drawn in the mockup; needs owner eye |
| - | `already_held`, `outcome_unknown`, `write_failed` rows | done | RV, LR `noteText` | Not drawn in the mockup; copy is new and needs owner eye |
| - | Task 6.11 free "Aplicar valor guardado" | done | `applyStoredReveal`, `applyStoredLushaValueAction`, LR `apply` | Not drawn in the mockup |
| - | Header: close button, focus trap, focus return | done | shared `Dialog` | |
