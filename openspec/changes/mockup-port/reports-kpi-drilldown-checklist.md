# /admin/reports KPI drill-down checklist

Source mockup: `openspec/changes/reports-kpi-drilldown/mockups/reports-kpi-drilldown.html` (+ `README.md`).
Columns: element | mockup ref | status | evidence | notes

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Tile "Tasa de respuesta" as `button.stat.stat-clickable` | state 1 | done | `admin/reports/CohortDrilldown.tsx:153`, `ReportsView.tsx:240` | opens Respondió; tone info, neutral under 10 contactados |
| Tile low sample "3 / 7", % in foot, still clickable | state 3 | done | `ReportsView.tsx:240` | `MIN_RATE_SAMPLE` only changes display; clickability uses the Respondió count |
| Tile with count 0 renders plain `.stat` | state 4 | done | `KpiDrilldownCard.tsx` (`clickable = value >= 1`) | |
| Tile keeps tone border on hover (shipped bug) | state 1 | done | `design-system.css:713` | hover recolors sides and bottom only |
| Tile label pinned to top (native button centering) | mockup `<style>` | done | `design-system.css:710` | |
| Dialog "Respondió" from tile and from funnel row (same list) | state 2 | done | `CohortDrilldown.tsx:153,193` | two triggers, same action and population |
| Dialog 7 columns incl. Respuesta recibida, Secuencia | state 2 | done | `CohortDrilldown.tsx:79-80,99-109` | |
| Reply time with HH:mm sub-line | state 2 | done | `CohortDrilldown.tsx:99-105` | from `activity.metadata.occurredAt` via `effectiveActivityAtSql` |
| Manual change: reply and Sequence show "—" | state 2 | done | `CohortDrilldown.tsx:99,109`, `queries.ts` left joins | |
| Contact link to `/contacts/{id}` | state 2 | done | `CohortDrilldown.tsx` (Link) | |
| Status badge | state 2 | done | `CohortDrilldown.tsx:92` | `statusBadgeClass` + `leadStatuses` |
| Sequence name as a link | state 2 | deviation | `CohortDrilldown.tsx:109` | no sequence detail route exists yet (`src/app/(app)/sequences` has only actions); plain text. Owner: link once the detail page ships |
| Header states population in words + second line (current status, not period) | state 2 | done | `lib/reports/cohortHeader.ts`, `CohortDrilldown.tsx:55` | line 2 quotes the full period phrase, e.g. «creados en octubre 2026» (mockup: «creados en octubre») |
| Dialog "Contactado": 5 columns, header | state 2b | done | `CohortDrilldown.tsx:72-82` | |
| Dialog "Reunión": 7 columns, header | state 2b | done | same | |
| Period phrase: month / quarter / week | states 2, 3, 6 | done | `cohortHeader.ts` `cohortPeriodPhrase` | |
| Empty-dialog text (list empty despite count >= 1) | state 4 | done | `CohortDrilldown.tsx:67` | one text per population |
| Funnel rows Contactado, Respondió, Reunión: dotted count + chevron, hover tint | state 5 | done | `CohortDrilldown.tsx:213-220`, `design-system.css:721-731` | |
| Funnel row aria-label "Ver los N contactos..." | state 5 | done | `ReportsView.tsx:355-380` | dictionary formatters |
| Funnel rows at 0: static, chevron width reserved | state 4 | done | `CohortDrilldown.tsx:201`, `design-system.css:733` | |
| Nuevo row and discarded footer stay static | state 5 | done | `ReportsView.tsx:344` | `funnel-static` on Nuevo |
| Bars untouched | state 5 | done | `ReportsView.tsx` | |
| `.dialog.xwide` 960px, fits 1024px | README | done | `design-system.css:692`, `Dialog.tsx:131` | measured 960px at a 1024px viewport |
| Truncation footer note, true total in header | state 6 | done | `KpiDrilldownCard.tsx:81`, `lib/reports/drilldownLimit.ts` | verified with 546 contacted: "Se muestran los primeros 500 de 546" |
| Truncation also on Reuniones agendadas and Empresas ganadas | state 6 | done | `KpiDrilldownCard.tsx`, `MeetingsKpiCard.tsx`, `WonCompaniesKpiCard.tsx` | shared dialog |
| Header cell alignment `th.right` (shipped bug) | scope | done | `design-system.css:64` | |
| Conversión por fuente rows | README open question | not built | n/a | out of scope, owner decision on a second batch |
