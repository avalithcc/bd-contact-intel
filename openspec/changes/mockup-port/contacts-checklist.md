# /contacts mockup parity checklist

Source mockups: `openspec/changes/crm-hubspot-ux/mockups/contacts.html` and
`contacts-board.html`. Audited against worktree tip `feat/mockup-port-04-columns`
(built on `feat/mockup-port-03-contacts` @ 4bc47e5, which already rebuilt
page.tsx/Board.tsx/BulkActionsBar.tsx onto the mockup's global CSS classes).
One row per visible element; "evidence" is the file the element currently
lives in (or "—" if not implemented at all).

Columns: element | mockup | status | evidence | notes

## Sidebar / topbar (out of scope for this change — ported in mockup-port-02-shell)

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Sidenav + topbar chrome | contacts.html:13-61 | done | src/app/(app)/Sidebar.tsx, TopBar.tsx | Not touched by this change. |

## Page header

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Eyebrow "Contactos" | contacts.html:65 | done | page.tsx:333 (`<div className="eyebrow">`) | |
| h1 "contactos." | contacts.html:65 | done | page.tsx:334-337 | |
| Meta paragraph | contacts.html:66 | done | page.tsx:338 | |
| Segmented Tabla/Tablero control | contacts.html:68-71 | done | page.tsx:342-351 (`.segmented`, `.on` active class, `TableIcon`/`BoardIcon`) | |
| "Importar" secondary button | contacts.html:72 | done | page.tsx:353-355 | |
| "Nuevo contacto" primary button | contacts.html:73 | todo | — | No create-contact affordance anywhere on the page or its dialogs. Biggest single gap. |

## View tabs

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| 6 system view tabs | contacts.html:75 | done | src/lib/contacts/views.ts SYSTEM_VIEWS, page.tsx:360-370 | Outreach tab has no count badge — pre-existing, owner-approved deviation (2026-09-26). |
| "Guardar vista" | contacts.html:75 | deviation | page.tsx:399-420 | Renders as a `.dropdown`/`.menu` (much closer to the mockup's affordance than a plain inline form), but still an inline form inside the menu, not the `#save-view` modal `.overlay` dialog with the "Incluye" chip/columns-count summary. |
| Saved view tabs (BD's own) | — | done | page.tsx:383-398, src/lib/contacts/savedViews.ts | Includes a delete ("×") affordance the mockup doesn't show a state for. |

## Toolbar — filter chips + "Agregar filtro"

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Removable filter chips (one per active filter, "Quitar filtro" button each) | contacts.html:77-79 | todo | page.tsx:535-613 | Current UI is a `.chip.chip-add` trigger opening one `<details>` menu with `<select>` dropdowns (owner/industryGroup/seniority/emailStatus/status) submitted together — no per-filter removable chip, no independent add/remove per filter. |
| "Agregar filtro" dropdown, 10 options | contacts.html:80-88 | partial | — | See per-filter rows below. |
| — Responsable | contacts.html:83 | done (as select, not chip) | page.tsx:544-556 | |
| — Estado | contacts.html:83 | done (as select, not chip) | page.tsx:592-602 | UI is single-select; `ContactFilters.status` is actually multi-value (`inArray`) in the DB layer — mockup shows "Nuevo, Contactado" (multi). Select-based UI can't express multi-select yet. |
| — Estado del correo | contacts.html:84 | done (as select, not chip) | page.tsx:582-590 | |
| — Empresa | contacts.html:84 | todo | — | No company-name/company-key filter exists in `ContactFilters` or the panel. |
| — Empresa con vacantes abiertas | contacts.html:85 | done (as implicit view filter, not toolbar toggle) | src/lib/contacts/viewFilters.ts `hiring` field, SYSTEM_VIEWS "Con vacantes abiertas" | Only reachable via the system view tab, not as an independent ad-hoc filter on top of any view. |
| — Mercado de contratación | contacts.html:85 | todo (regular view) / done (Outreach view only) | src/lib/contacts/outreachViewParams.ts, page.tsx:490-499 (Outreach branch only) | `market`/`miamiOnly` only exist on the Outreach-view branch, not in `ContactFilters` for the regular table. |
| — Grupo de rol | contacts.html:86 | todo (regular view) / done (Outreach view only) | src/lib/roleGroups.ts, page.tsx:459-467 (Outreach branch only) | Not wired into `ContactFilters`/the general filter panel. |
| — Startup | contacts.html:86 | todo (regular view) / done (Outreach view only) | page.tsx:522-527 (Outreach branch only) | Same gap. |
| — BD conectado | contacts.html:87 | todo | — | No filter by connected-BD exists. The read side now exists (`src/lib/contacts/bdConnections.ts`, this batch) but nothing filters by it yet. |
| — Última actividad | contacts.html:87 | todo | — | No "last activity" filter (recency bucket) exists. |
| "Borrar todo" | contacts.html:89 | deviation | page.tsx:608-610 (`l.filtersClear` link) | Clears ad-hoc filters via a link back to `?view=X`, but lives inside the filter panel, not as a toolbar-level "Borrar todo" button next to chips. |
| "Ordenado por Última actividad" indicator | contacts.html:91 | **done (branch 05)** | page.tsx (`l.sortedByPrefix`), default `sort=lastActivity` | |
| "Columnas" dropdown, 12 checkable columns | contacts.html:92-94 | done | src/lib/contacts/columns.ts, page.tsx | All 12 mockup columns now selectable. |
| — drag to reorder | contacts.html:93 (`.drag` handles) | **done (branch 06)** | src/app/(app)/contacts/ColumnPicker.tsx, src/lib/contacts/columnOrder.ts | `sanitizeColumnKeys` now order-preserves (caller order, dedup by first occurrence) instead of always re-sorting to a fixed order — a real behavior change, existing tests updated. Drag-and-drop via native HTML5 DnD; also added Up/Down buttons per row for keyboard accessibility (task instruction), which the static mockup doesn't show but doesn't contradict either. |
| — "Restablecer" | contacts.html:94 | **done (branch 06)** | ColumnPicker.tsx `reset()` | Resets both order and checked set to `DEFAULT_CONTACT_COLUMNS`. |
| — "Aplicar" | contacts.html:94 | done | page.tsx:445-447 | |
| "Exportar" (toolbar-level, whole filtered view) | contacts.html:95 | todo | src/lib/contacts/csvExport.ts (bulk-selection export only) | Only a bulk/selection-scoped export exists (BulkActionsBar.tsx `buildExportHref`); no toolbar-level "export the whole current view" action. |

## Bulk bar

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| "N seleccionados" count | contacts.html:98 | done | BulkActionsBar.tsx | |
| Asignar responsable | contacts.html:99 | done | BulkActionsBar.tsx, src/lib/contacts/bulkActions.ts | |
| Crear tarea | contacts.html:100 | done | BulkActionsBar.tsx | |
| Generar mensajes | contacts.html:101 | **done (branch 07) — owner confirmation needed on the cap** | src/app/(app)/contacts/BulkGenerateMessagesButton.tsx, bulkMessageActions.ts, src/lib/contacts/bulkMessages.ts | Smallest faithful version per owner decision: runs `generatePersonOutreachMessageAction` (the SAME person-scoped generator `/contacts/[id]` uses — NOT the legacy contact-scoped `generateOutreachMessage`, which would 404 for most unified Contacts) sequentially over the selection, capped at `MAX_BULK_GENERATE_MESSAGES = 25`. Results render in a dialog, one per contact, each with its own copy button (reusing the same copy/copied/error/pending strings as the per-contact button). **The 25 cap is a stopgap, not a spec'd number — needs explicit owner confirmation before this is considered final**, and a capped run shows a visible warning banner in the dialog. |
| Exportar | contacts.html:102 | done | BulkActionsBar.tsx `buildExportHref` | Now includes the `bdConnections` column in the exported CSV when visible (this batch). |
| "Seleccionar los N" | contacts.html:104 | todo | — | No "select all N matching the filter, not just this page" affordance; only page-level "select all" exists. |
| Quitar selección | contacts.html:105 | done | BulkActionsBar.tsx `clearSelection` | |

## Table

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Sortable header indicators (Nombre, Última actividad shown sorted) | contacts.html:108-109 | **done (branch 05)** | page.tsx `sortHref`, src/lib/contacts/sort.ts, listQueries.ts `lastActivityAgg` | Two sortable headers (Nombre, Última actividad), plain link toggle (no client JS), default sort = Última actividad desc, matching the mockup's default. No asc/desc toggle affordance (the static mockup shows none either). |
| Row checkbox / "select all" | contacts.html:108, 111 | done | page.tsx | |
| cell-person (avatar, name link, sub-line) | contacts.html:112 | done | page.tsx (`Avatar` + `initialsFromName`) | |
| Empresa column | contacts.html:113 | partial | page.tsx `columnCell` "company" | Plain `.soft` text; no company-logo initial chip, no inline "Contratando" hiring badge on the row. |
| Responsable (owner) as owner-chip w/ avatar | contacts.html:114 | done | page.tsx `columnCell` "owner" (`owner-chip` + `Avatar` variant="bd") | |
| Estado badge | contacts.html:115 | done | page.tsx `columnCell` "status" (`badge badge-${status}`) | |
| Correo (verified/probable/none badge + address) | contacts.html:116 | done | page.tsx `columnCell` "email" | |
| BDs conectados (avatar stack, tooltip of names) | contacts.html:117 | **done (this batch)** | src/lib/contacts/bdConnections.ts, src/lib/contacts/listQueries.ts `attachBdConnections`, page.tsx `columnCell` "bdConnections" | New column, selectable via the picker, exported in CSV. Reads `person_bd_connection` joined to `bd`, batched per already-paginated page/board-column/export id set (never unbounded). See TDD Cycle Evidence below. |
| Última actividad (relative time + activity text) | contacts.html:118 | **done (branch 05)** | src/lib/contacts/lastActivity.ts, listQueries.ts `attachDerivedColumns`, page.tsx `columnCell` "lastActivity" | Owner decision: label = latest activity's type label in Spanish (reusing the record page's Timeline activity-type taxonomy, src/lib/activity/queries.ts TIMELINE_ACTIVITY_TYPES) + relative time, e.g. "Correo enviado · hace 2d". `status_change`/`status_backfill` special-cases "replied" -> "Respuesta recibida"; other statuses fall back to their own leadStatuses label. No `linkedin_message`/`reply_received` activity type exists in the schema (only note/email_sent/hunter_lookup/status_change/meeting_logged/discarded/status_backfill), so those two mockup examples are approximated via the closest real type rather than invented. |
| Grupo de rol | contacts.html:119 | done | page.tsx `columnCell` "roleGroup" | |
| Sort indicator arrow (↓) | contacts.html:109 | **done (branch 05)** | page.tsx (`<span className="sort">↓</span>` on the active sort header) | |

## Table footer

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| "Mostrando X-Y de Z" | contacts.html:251 | done | page.tsx (`l.showingRange`) | |
| Anterior / Siguiente pagination | contacts.html:251 | done | page.tsx, listQueries.ts `getContactListPage` | Server-paginated (`limit`/`offset`), disabled-on-boundary state matches mockup. |

## #new-contact dialog

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Nombre / Apellido fields | contacts.html:259-260 | todo | — | No create-contact form/dialog exists anywhere in `/contacts`. |
| LinkedIn URL field (strongest identity key) | contacts.html:261 | todo | — | `src/lib/identity/resolve.ts`/`resolveDb.ts` already implement LinkedIn-first identity resolution for ingest paths; nothing calls it from a manual "new contact" UI yet. |
| Correo / Empresa fields | contacts.html:262-263 | todo | — | |
| Duplicate-detection warning banner | contacts.html:264 | todo | — | `src/lib/identity/duplicateReviewQueries.ts` exists for the admin Duplicates screen; nothing surfaces a same-name+company duplicate warning inline in a create-contact flow. |
| Cancelar / "Crear de todas formas" footer | contacts.html:266 | todo | — | |

## #save-view dialog

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Name field, "Incluye" chip summary, help text | contacts.html:271-273 | deviation | page.tsx:399-420, src/lib/contacts/savedViews.ts | Functionally covered (name + current filters serialized) inside a dropdown menu, not a modal dialog, and without the "Incluye" chip/columns-count preview. |

## Board (contacts-board.html)

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Segmented control on Tablero | contacts-board.html:68-71 | done | page.tsx (shared with table) | |
| Toolbar: single "Responsable: Yo" chip + own-company note | contacts-board.html:76 | todo | — | Board reuses the exact same filter panel as the table, not a board-specific single-chip toolbar; no "never show own-company people" note or enforcement visible. |
| 5 board columns, header badge + count | contacts-board.html:77-89 | done | src/lib/contacts/board.ts BOARD_COLUMNS, Board.tsx, listQueries.ts getContactBoardColumns | Board columns now also carry `bdConnections` per row (type-level parity with the table), though the board card markup doesn't render it — the mockup's board card doesn't show BDs-conectados either. |
| board-card (title, sub, avatar-bd + first-name meta, badge) | contacts-board.html:77-88 | done | Board.tsx | |
| "Ver los N" col-more link | contacts-board.html:77 | done | Board.tsx | |
| Drag-and-drop between columns | contacts-board.html:86 | done | src/app/(app)/contacts/BoardDnD.tsx, src/lib/contacts/board.ts boardDropAction | Progressive enhancement over `/contacts/[id]?openAction=X`. |
| Log-meeting dialog on drop-to-Reunión | contacts-board.html:93-105 | done (via record page) | `/contacts/[id]?openAction=meeting` | Opens on the record page, not inline on the board — functionally equivalent per design. |
| Discard dialog (mandatory reason) | contacts-board.html:106-121 | done (via record page) | `/contacts/[id]?openAction=discard` | Same caveat as log-meeting. |

## Summary

- Done: 27
- Partial/deviation (functional, visual/UX gap only): 6
- Todo (feature genuinely missing): 19

Biggest remaining gaps, in priority order: (1) no create-contact flow at all
(identity-resolved, with duplicate warning), (2) filter chips + 6 of 10
"Agregar filtro" options missing from the general filter panel (company,
hiring-as-standalone-toggle, market, role group, startup, BD-conectado,
last-activity — the last two now have a read-side building block in
`bdConnections.ts`/`getContactBdConnectionsByIds`-equivalent grouping, but no
filter predicate yet), (3) no sorting on any column, (4) "Última actividad"
column still missing (needs an `activity`-type→label design decision), (5)
column drag-reorder + "Restablecer" missing, (6) bulk "Generar mensajes" not
wired, (7) toolbar-level "Exportar" (whole view) missing, (8) "Seleccionar
los N" missing.

## This batch (feat/mockup-port-04-columns)

Closed exactly one checklist row: "BDs conectados" column (table + board +
CSV export), with TDD evidence in the apply-progress artifact. Everything
else above is unchanged from feat/mockup-port-03-contacts and is explicit,
prioritized scope for the next chained branch(es) — see the apply-progress
report's "Remaining Tasks" for a batch-by-batch breakdown.
