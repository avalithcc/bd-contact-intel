# reports-kpi-drilldown — mockup

Design-only. No application code changed. Open `reports-kpi-drilldown.html` in a browser (desktop only). It extends the approved `owner-reporting/mockups/reports.html` and the shipped drill-downs for "Reuniones agendadas" and "Empresas ganadas". Numbers are illustrative but consistent (118 nuevos → 43 contactados → 12 respondieron → 4 en reunión).

**Decision needed:** approve the six states below, the two new CSS pieces (`.funnel-live`, `.dialog.xwide`), and answer the open question at the end.

## States in the page

| # | State | What to check |
|---|-------|---------------|
| 1 | KPI row | "Tasa de respuesta" next to the two tiles that already open a dialog. Same `button.stat.stat-clickable`. |
| 2 | Dialog "Respondió" | 7 columns, header states the population in words. Opens from the tile and from the funnel row (same list). |
| 2b | Dialogs "Contactado" and "Reunión" | Contactado has 5 columns (no reply columns); Reunión has the same 7 as Respondió. |
| 3 | Low sample | Tile `3 / 7`, neutral tone, percentage in the foot. Still clickable (3 rows). |
| 4 | Empty | `0 / 7` renders as a plain tile (no hover, no click). Empty-dialog text only appears if the list arrives empty despite a count of 1 or more. |
| 5 | Funnel rows | Contactado, Respondió, Reunión: dotted-underlined count plus chevron. Bars untouched. |
| 6 | Truncation | Pinned footer note "Se muestran los primeros 500 de 612…"; header keeps the real total. |

## Scope

| Number | Clickable | Population |
|--------|-----------|------------|
| Tasa de respuesta (tile) | New | Persons created in the period whose status today is `replied` or `meeting` |
| Contactado (funnel) | New | Created in the period, status today `contacted`, `replied` or `meeting` |
| Respondió (funnel) | New | Same list as the tile |
| Reunión (funnel) | New | Created in the period, status today `meeting` |
| Reuniones agendadas, Empresas ganadas | Already | Unchanged |
| Contactos nuevos, Nuevo, descartados footer | Static | No list; Nuevo is the whole cohort |
| Conversión por origen rows | Static | See open question |

## Things the owner should know before approving

- **Two "meetings" numbers can disagree.** The tile "Reuniones agendadas" counts logged meetings in the period (5 here); the funnel "Reunión" counts the cohort now in status meeting (4). Both open different lists, by design of the shipped code.
- **Truncation is new.** The shipped dialogs cut at 500 rows silently. The note in state 6 would also apply to them.
- **Dialog width.** `.dialog.wide` (720px) cannot hold 7 columns; the mockup uses a local `.dialog.xwide` (960px, still fits 1024px).
- **"Respuesta recibida" and "Secuencia" are blank for manual status changes.** A contact moved to `replied` by hand has no reply event, so both show "—".
- **Discoverability.** The tiles show no clickable hint until hover (as shipped). Funnel rows get an explicit hint because they have no hover precedent. Say if you want the tiles to match.

## Design-system usage

Reused from the shared stylesheet: `.stat` and its tones, `.dialog`, `.dialog.wide`, `.dialog-footer .left`, `table.data.compact`, `.badge-replied/-meeting/-contacted`, `.card`, `.bar-track`, `.grid-4`, `.grid-2`, `.segmented`, `.tag`, `.mock-note`. Not reused: `.locked` (it is a callout).

Local `<style>` block: `.stat-clickable` (copy of `src/app/design-system.css:699-703`), `.mb-md` (exists in the app's `globals.css`), `.funnel-live`, `.funnel-static`, `.dialog.xwide`, plus mockup-only scaffolding (`.stage`, `.captions`, `.cell-sub`).

## Open question

¿Las filas de Conversión por fuente, que muestran el mismo valor, entran en una segunda tanda?
