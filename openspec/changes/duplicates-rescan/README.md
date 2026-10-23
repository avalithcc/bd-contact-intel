# duplicates-rescan mockup

One page, five states stacked: `duplicates-rescan.html`. Open with `open openspec/changes/duplicates-rescan/duplicates-rescan.html`. It reuses `../crm-hubspot-ux/mockups/styles.css` as is; nothing new in CSS. Desktop only. Nothing here is implemented.

## The problem, measured (production, read-only, 2026-10-23)

- Duplicate detection is write-time only. A `duplicate_candidate` row is created when a contact is written; nothing ever re-scans existing contacts. No cron, route or script does it.
- `duplicate_candidate`: 333 merged + 2 not_duplicate, **zero open**. Newest row created 2026-09-29, so 24 days with no detection.
- 27,511 live persons. The matcher's own `buildNameCompanyKey` finds **31 colliding groups covering 62 people**. Only 2 were ever flagged; **29 were never seen**.
- **12 of the 31 groups have two different BDs on the same person.** In 10 of the 12, one copy has the email and the other has none: the same person entered twice from two sources.

| Person | Company | What is happening |
|---|---|---|
| Nicolás Velazco | Snoop Consulting | Cristian Civita 16 activities, Mariel Meza 1 |
| Martin Bonamico | Mercado Libre | Mariel Meza 6, last yesterday; the other copy has no owner, 1 activity |
| Juan Santiago Preisegger | dLocal | Macarena Dávila 5, last Oct 21; Cristian Civita 0 |
| Christian Garro | PedidosYa | Mariel Meza 3; Cristian Civita 0 |
| Lean Roldan | Compañía Mega | Macarena has `lean.roldan@ciamega.com.ar`; Mariel has `lhroldan@gmail.com` |

The screen said "0 abiertos", which read as good news. It meant nobody was looking.

## What you approve

1. **State 1, today.** The approved empty queue plus a warning that this zero is not "clean data".
2. **State 2, the re-scan panel.** Last run (when, daily or by hand, how many candidates it created), the per-run cap, a "Solo simular" checkbox (ticked by default) and the "Re-escanear" button. Card shape follows the existing admin screens (`rfc-backfill`): explanation, current numbers, then one form.
3. **State 3, dry run.** What the run would create, creating nothing: the 31 = 29 + 2 equation, and a line per pair, contested ones first.
4. **State 4, after the first real run.** The approved queue and side-by-side comparison, now with 29 open pairs (real examples).
5. **State 5, the run report.** Pairs already merged or already marked "no es duplicado" are reported as **omitidos**, so 31 groups = 29 created + 2 skipped adds up.
6. The backend shape behind it (not drawn): a daily cron route, also callable by hand with the bearer secret and `?dryRun=1`, writing an audit row with `trigger: "cron"`; and an admin "run now" action that follows `rfc-backfill` (admin only, server-clamped cap, audit row, redirect with the result in the URL).

## Decisions already taken (rendered, not up for debate)

- **Same exact key as write-time detection**: `buildNameCompanyKey`, normalized name + `::` + company key. It is deliberately not loosened. The re-scan closes the gap between "ran at write time" and "never ran again"; it does not invent a looser rule.
- **Consequence you should expect**: two people named "Roberto Gorchs" at company keys `andina tech` and `andina` do **not** collide and are **not** flagged. That is a human judgement, not a detection failure. Do not be surprised when such pairs are absent.
- Daily is enough. No sub-minute freshness.
- A pair already merged or marked "no es duplicado" can never come back: the `unique (person_a_id, person_b_id)` constraint ignores status and every insert uses `onConflictDoNothing`. The run reports these as skipped.

## Open questions for you

1. **Owner and activity per side.** The approved `duplicates.html` comparison already has "Responsable" and "Actividad" rows, so the mockup renders them as approved (see the Velazco comparison: Cristian 16 vs Mariel 1). Two gaps remain, both about the real app, not the mockup:
   - The current app comparison (`admin/duplicates/page.tsx`) shows the owner row but has **no activity row**. The approved design needs it; the build must add it.
   - The **queue list** (left) shows only name, company and reason. With 29 pairs, you cannot tell which ones are contested without opening each. Should the list carry owners and activity, or a "con dos BDs" marker? I rendered the approved list unchanged.
2. **Queue order.** The approved queue sorts by "Recientes" or "Empresa"; it does not sort by activity. After one run all 29 rows have the same creation time, so "Recientes" is arbitrary and the contested ones would not surface first. I drew them first in the mockup, but that order needs a decision: a third sort option such as "Con más actividad" (default), or something else.
3. **Per-run cap.** Drawn as 50, an assumption. 29 fits. Above the cap, the run creates up to the cap and leaves the rest for the next run (the owner-recompute cron instead refuses above its cap). Which behaviour do you want?
4. **Cron hour.** Text says "de madrugada" without an hour; the owners cron runs 03:00 Buenos Aires.

## Things the mockup does not show

- The merge history table and the "Deshacer fusión" dialog are unchanged from the approved screen and not repeated.
- Comparison rows with no measured data (cargo, correo, ubicación, origen) are omitted for Velazco instead of invented. The real screen shows every approved row.
- The 2 skipped pairs are shown by reason, not by name (names were not measured). The 1 + 1 split is illustrative; the total, 2, is measured.
- The 12 contested groups: only the 5 measured are drawn. The mockup assumes the 2 skipped groups are not among the contested ones; the first dry run will say.
