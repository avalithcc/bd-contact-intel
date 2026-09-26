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
| Segmented Tabla/Tablero control | contacts.html:68-71 | **done, audited pixel-by-pixel (branch 13)** | page.tsx (`.segmented`, `.on` active class), src/components/icons.tsx `TableIcon`/`BoardIcon` | Re-checked against contacts.html:68-71's exact markup: same wrapper classes/aria-label, same `.on`/plain toggle, and the SVG `<path>`/`<rect>` coordinates in `TableIcon`/`BoardIcon` are byte-identical to the mockup's inline SVGs. No difference found. |
| "Importar" secondary button | contacts.html:72 | done | page.tsx:353-355 | |
| "Nuevo contacto" primary button | contacts.html:73 | **done (branch 08)** | src/app/(app)/contacts/NewContactDialog.tsx | Opens the dialog; wired to createContactActions.ts. |

## View tabs

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| 6 system view tabs | contacts.html:75 | done | src/lib/contacts/views.ts SYSTEM_VIEWS, page.tsx:360-370 | Outreach tab has no count badge — pre-existing, owner-approved deviation (2026-09-26). |
| "Guardar vista" | contacts.html:75 | **done (branch 11)** | src/app/(app)/contacts/SaveViewDialog.tsx, src/lib/contacts/filterChips.ts `buildSaveViewSummary` | Now a real modal via the shared Dialog component, with the mockup's "Incluye" chip summary (reuses the same `activeFilterChips` the toolbar chips use, plus a "Columnas: N" line) and help text. Submission is the same unchanged `createSavedViewAction`. |
| Saved view tabs (BD's own) | — | done | page.tsx:383-398, src/lib/contacts/savedViews.ts | Includes a delete ("×") affordance the mockup doesn't show a state for. |

## Toolbar — filter chips + "Agregar filtro"

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Removable filter chips (one per active filter, "Quitar filtro" button each) | contacts.html:77-79 | **done (branch 09/09b; reworked branch 13)** | src/app/(app)/contacts/FilterMenu.tsx, src/lib/contacts/filterChips.ts | Clicking a chip's label reopens that filter's own inline editor, pre-filled with its current value (mockup shape); the "×" still removes it directly. |
| "Agregar filtro" dropdown, 10 options | contacts.html:80-88 | **done, matches mockup shape (branch 13)** | FilterMenu.tsx, src/lib/contacts/filterFieldKinds.ts | Now a real dropdown listing the 10 mockup options; picking one opens THAT filter's own inline editor (select/multiselect/checkbox/text per `FILTER_FIELD_KIND`), not one shared panel with all 10 fields at once. industryGroup/seniority (pre-existing, task 13.3 `/leads` parity — not in the mockup's 10) are kept addable in a second "more filters" group below a separator rather than silently dropped. |
| — Responsable | contacts.html:83 | done (as select, not chip) | page.tsx:544-556 | |
| — Estado | contacts.html:83 | **done, multi-select (branch 09/09b)** | page.tsx (checkbox group, `name="status"`), viewFilters.ts (comma-joined ad-hoc override) | Now genuinely multi-select, matching the mockup's "Nuevo, Contactado" chip. |
| — Estado del correo | contacts.html:84 | done (as select, not chip) | page.tsx:582-590 | |
| — Empresa | contacts.html:84 | **done (branch 09/09b)** | viewFilters.ts `company`, listQueries.ts `ilike(person.company, ...)` | Free-text substring match, not an exact companyKey match. |
| — Empresa con vacantes abiertas | contacts.html:85 | **done, ad-hoc (branch 09/09b)** | viewFilters.ts `hiring` (now ad-hoc overridable), page.tsx checkbox | Reachable both via the system view tab AND as an independent ad-hoc toggle on top of any view. |
| — Mercado de contratación | contacts.html:85 | **done (branch 09/09b)** | viewFilters.ts `market`, listQueries.ts (reuses `getHiringMatchIndex`, same crossover the Outreach view uses) | `miamiOnly` stays Outreach-view-only (that view's own extra Florida cut); the general filter exposes the 3 `MarketKey` buckets (latam/us/other). |
| — Grupo de rol | contacts.html:86 | **done (branch 09/09b)** | viewFilters.ts `roleGroup`, listQueries.ts `eq(person.roleGroup, ...)` | Now wired into the general `ContactFilters`/panel too. |
| — Startup | contacts.html:86 | **done (branch 09/09b)** | viewFilters.ts `startupsOnly`, listQueries.ts (same `getHiringMatchIndex` crossover as market) | |
| — BD conectado | contacts.html:87 | **done (branch 09/09b)** | viewFilters.ts `bdConnected`, listQueries.ts (EXISTS on `person_bd_connection`) | Reuses the same `ownerOptions` BD list already fetched for "Responsable" — no new query. |
| — Última actividad | contacts.html:87 | **done (branch 09/09b); bug fixed (branch 10)** | viewFilters.ts `lastActivityDays`, listQueries.ts (EXISTS on `activity`, bounded by `activity_person_idx`/`activity_created_idx`) | Fixed buckets (7/30/90 days), not a free date-range picker. **Prod bug fixed (branch 10):** the EXISTS check used raw `created_at`, so `lastActivityDays=30` wrongly matched every `status_backfill` row imported in the last 30 days regardless of the event's real historical time — now uses the same effective-time CASE expression as the column/sort. |
| "Borrar todo" | contacts.html:89 | **done (branch 09/09b)** | page.tsx `clearAllFiltersHref` | Real toolbar-level button next to the chips (only rendered when a filter is active) that clears every ad-hoc filter while preserving sort/columns/search/page-size. |
| "Ordenado por Última actividad" indicator | contacts.html:91 | **done (branch 05)** | page.tsx (`l.sortedByPrefix`), default `sort=lastActivity` | |
| "Columnas" dropdown, 12 checkable columns | contacts.html:92-94 | done | src/lib/contacts/columns.ts, page.tsx | All 12 mockup columns now selectable. |
| — drag to reorder | contacts.html:93 (`.drag` handles) | **done (branch 06)** | src/app/(app)/contacts/ColumnPicker.tsx, src/lib/contacts/columnOrder.ts | `sanitizeColumnKeys` now order-preserves (caller order, dedup by first occurrence) instead of always re-sorting to a fixed order — a real behavior change, existing tests updated. Drag-and-drop via native HTML5 DnD; also added Up/Down buttons per row for keyboard accessibility (task instruction), which the static mockup doesn't show but doesn't contradict either. |
| — "Restablecer" | contacts.html:94 | **done (branch 06)** | ColumnPicker.tsx `reset()` | Resets both order and checked set to `DEFAULT_CONTACT_COLUMNS`. |
| — "Aplicar" | contacts.html:94 | done | page.tsx:445-447 | |
| "Exportar" (toolbar-level, whole filtered view) | contacts.html:95 | **done (branch 09b) — owner confirmation needed on the cap** | page.tsx `toolbarExportHref`, export/route.ts (whole-view mode) | Reuses `getContactListPage` with the current filters/sort and a page size of `MAX_VIEW_EXPORT_ROWS = 5000` instead of the usual 50, capped so an unfiltered 26,606-row view can't return an unbounded CSV. A capped response sets `X-Export-Truncated: 1` (no UI currently surfaces it). **The 5000 cap is a stopgap, not a spec'd number — same "needs owner confirmation" flag as the bulk-message-generation cap.** |

## Bulk bar

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| "N seleccionados" count | contacts.html:98 | done | BulkActionsBar.tsx | |
| Asignar responsable | contacts.html:99 | done | BulkActionsBar.tsx, src/lib/contacts/bulkActions.ts | |
| Crear tarea | contacts.html:100 | done | BulkActionsBar.tsx | |
| Generar mensajes | contacts.html:101 | **done (branch 07) — owner confirmation needed on the cap** | src/app/(app)/contacts/BulkGenerateMessagesButton.tsx, bulkMessageActions.ts, src/lib/contacts/bulkMessages.ts | Smallest faithful version per owner decision: runs `generatePersonOutreachMessageAction` (the SAME person-scoped generator `/contacts/[id]` uses — NOT the legacy contact-scoped `generateOutreachMessage`, which would 404 for most unified Contacts) sequentially over the selection, capped at `MAX_BULK_GENERATE_MESSAGES = 25`. Results render in a dialog, one per contact, each with its own copy button (reusing the same copy/copied/error/pending strings as the per-contact button). **The 25 cap is a stopgap, not a spec'd number — needs explicit owner confirmation before this is considered final**, and a capped run shows a visible warning banner in the dialog. |
| Exportar | contacts.html:102 | done | BulkActionsBar.tsx `buildExportHref` | Now includes the `bdConnections` column in the exported CSV when visible (this batch). |
| "Seleccionar los N" | contacts.html:104 | **done, page-scoped (branch 09b) — true filter-wide bulk action needs an owner decision** | BulkActionsBar.tsx `selectAllMatching` | Deviation, documented in code: every bulk action here (owner/task/messages/export) takes an explicit checked-id list, not a filter predicate — there is no server-side "act on everything matching this filter" mode. The button shows the mockup's exact "Seleccionar los N" label and selects everything on the current page (same as the header checkbox), then shows a banner clarifying bulk actions only apply to this page. Turning this into a true filter-scoped bulk action (server-side, no id list) is a larger, separate change — flagged as needing an explicit owner decision, not invented silently. |
| Quitar selección | contacts.html:105 | done | BulkActionsBar.tsx `clearSelection` | |

## Table

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Sortable header indicators (Nombre, Última actividad shown sorted) | contacts.html:108-109 | **done (branch 05); bug fixed (branch 10)** | page.tsx `sortHref`, src/lib/contacts/sort.ts, listQueries.ts `lastActivityAgg` | Two sortable headers (Nombre, Última actividad), plain link toggle (no client JS), default sort = Última actividad desc, matching the mockup's default. No asc/desc toggle affordance (the static mockup shows none either). **Prod bug fixed (branch 10):** `lastActivityAgg`'s MAX used raw `created_at`, so recently-imported `status_backfill` rows (collapse/fold backfills from 2026-09-24/25, HubSpot backfills from 2026-09-26) sorted to the top of the default list regardless of when the event actually happened — now MAXes the effective-time expression instead. |
| Row checkbox / "select all" | contacts.html:108, 111 | done | page.tsx | |
| cell-person (avatar, name link, sub-line) | contacts.html:112 | done | page.tsx (`Avatar` + `initialsFromName`) | |
| Empresa column | contacts.html:113 | **done (branch 12)** | page.tsx `columnCell` "company", src/lib/contacts/companyLogo.ts | Company-logo initial chip (`.company-logo`) + inline "Contratando" badge, matching the mockup. Badge reuses `getHiringMatchIndex()` fetched ONCE per page load (added to the existing `Promise.all`, alongside `hiringKeys`) — no per-row query; `ContactListRow` gained `companyKey` (previously only the display `company` name was selected) so the badge can look up membership by key, not by fuzzy name match. |
| Responsable (owner) as owner-chip w/ avatar | contacts.html:114 | done | page.tsx `columnCell` "owner" (`owner-chip` + `Avatar` variant="bd") | |
| Estado badge | contacts.html:115 | done | page.tsx `columnCell` "status" (`badge badge-${status}`) | |
| Correo (verified/probable/none badge + address) | contacts.html:116 | done | page.tsx `columnCell` "email" | |
| BDs conectados (avatar stack, tooltip of names) | contacts.html:117 | **done (this batch)** | src/lib/contacts/bdConnections.ts, src/lib/contacts/listQueries.ts `attachBdConnections`, page.tsx `columnCell` "bdConnections" | New column, selectable via the picker, exported in CSV. Reads `person_bd_connection` joined to `bd`, batched per already-paginated page/board-column/export id set (never unbounded). See TDD Cycle Evidence below. |
| Última actividad (relative time + activity text) | contacts.html:118 | **done (branch 05); bug fixed (branch 10)** | src/lib/contacts/lastActivity.ts, listQueries.ts `attachDerivedColumns`, page.tsx `columnCell` "lastActivity" | Owner decision: label = latest activity's type label in Spanish (reusing the record page's Timeline activity-type taxonomy, src/lib/activity/queries.ts TIMELINE_ACTIVITY_TYPES) + relative time, e.g. "Correo enviado · hace 2d". `status_change`/`status_backfill` special-cases "replied" -> "Respuesta recibida"; other statuses fall back to their own leadStatuses label. No `linkedin_message`/`reply_received` activity type exists in the schema, so those two mockup examples are approximated via the closest real type rather than invented. **Prod bug (branch 10):** the "latest activity" pick used `activity.created_at` for every row, including `status_backfill` migration reconstructions whose real time is `metadata.originalAt` — 3,517 HubSpot backfills imported the same day all read as "active today". Fixed via a shared `effectiveActivityAtSql()` CASE expression (listQueries.ts) used consistently in the DISTINCT ON pick, the sort's `lastActivityAgg` MAX, and the `lastActivityDays` EXISTS filter — see src/lib/contacts/effectiveActivityTime.ts for the pure rule this SQL mirrors (same as src/lib/status/deriveStatus.ts's status-derivation rule). |
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
| Nombre / Apellido fields | contacts.html:259-260 | **done (branch 08)** | NewContactDialog.tsx | |
| LinkedIn URL field (strongest identity key) | contacts.html:261 | **done (branch 08)** | NewContactDialog.tsx, src/lib/contacts/createContact.ts (`normalizeProfileKey`) | Deviation: does NOT reuse `@/lib/identity/resolve.ts`'s bulk ingest planner (`planIdentityWrites`/`buildIdentityWriteRows`) — that machinery requires a real legacy `contact`/`lead` row (`legacyTable`/`legacyId`), which a manually-typed contact has none of. Instead reuses `matchIdentity` directly (`@/lib/identity/matcher`), the actual matching algorithm every ingestion path shares, via two targeted indexed reads (profile key exact match; company-key-scoped rows filtered by normalized name) — see createContactActions.ts's doc comment. |
| Correo / Empresa fields | contacts.html:262-263 | **done (branch 08)** | NewContactDialog.tsx | A manually typed email is always `emailStatus: "probable"`, never "verified" (no Hunter lookup on this quick-add path) — documented in createContact.ts. |
| Duplicate-detection warning banner | contacts.html:264 | **done (branch 08)** | createContactActions.ts, `duplicateCandidate` insert | An exact match (profile key/verified email) blocks creation outright and links to the existing record (no "crear de todas formas" — it IS the same person). A name+company match shows the mockup's exact banner semantics (never auto-merged) with "Abrir el existente" / "Crear de todas formas"; confirming inserts a real `duplicateCandidate` row (same table the admin Duplicates screen reads) so an admin reviews it later. |
| Cancelar / "Crear de todas formas" footer | contacts.html:266 | **done (branch 08)** | NewContactDialog.tsx | |

## #save-view dialog

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Name field, "Incluye" chip summary, help text | contacts.html:271-273 | **done (branch 11)** | SaveViewDialog.tsx, src/lib/contacts/savedViews.ts | Real modal (shared Dialog), name field, "Incluye" chip summary + columns count, help text — matches the mockup. |

## Board (contacts-board.html)

| element | mockup | status | evidence | notes |
|---|---|---|---|---|
| Segmented control on Tablero | contacts-board.html:68-71 | done | page.tsx (shared with table) | |
| Toolbar: single "Responsable: Yo" chip + own-company note | contacts-board.html:76 | **done, note added; chip UX intentionally kept richer (branch 09b)** | page.tsx (own-company note above `<Board>`) | Board still reuses the general filter/chips toolbar rather than collapsing to a single fixed "Responsable: Yo" chip — showing the BD's REAL active filters as removable chips is strictly more capable than a hardcoded static chip, kept as an intentional improvement. The "never show own-company people" note now renders above the board; the invariant already held everywhere (table and board) before this batch — the identity resolver skips own-company matches at ingest time (`src/lib/identity/matcher.ts` `skip_own_company`), so no such person row ever exists to filter out. |
| 5 board columns, header badge + count | contacts-board.html:77-89 | done | src/lib/contacts/board.ts BOARD_COLUMNS, Board.tsx, listQueries.ts getContactBoardColumns | Board columns now also carry `bdConnections` per row (type-level parity with the table), though the board card markup doesn't render it — the mockup's board card doesn't show BDs-conectados either. |
| board-card (title, sub, avatar-bd + first-name meta, badge) | contacts-board.html:77-88 | done | Board.tsx | |
| "Ver los N" col-more link | contacts-board.html:77 | done | Board.tsx | |
| Drag-and-drop between columns | contacts-board.html:86 | done | src/app/(app)/contacts/BoardDnD.tsx, src/lib/contacts/board.ts boardDropAction | Progressive enhancement over `/contacts/[id]?openAction=X`. |
| Log-meeting dialog on drop-to-Reunión | contacts-board.html:93-105 | done (via record page) | `/contacts/[id]?openAction=meeting` | Opens on the record page, not inline on the board — functionally equivalent per design. |
| Discard dialog (mandatory reason) | contacts-board.html:106-121 | done (via record page) | `/contacts/[id]?openAction=discard` | Same caveat as log-meeting. |

## Summary

Every checklist row that started as "todo" (feature genuinely missing) is
now closed. What remains is a small set of **explicitly documented
deviations** — UX simplifications or owner-confirmation-needed stopgaps,
never a silently dropped feature:

1. **"Guardar vista" / "#save-view" dialog** — a dropdown menu + inline
   form, not the mockup's modal `.overlay` dialog with an "Incluye"
   chip/columns-count summary. Functionally complete.
2. **Segmented Tabla/Tablero control** and a few other chrome details —
   ported onto the mockup's real CSS classes (branch 03), functionally and
   visually equivalent, but not re-audited pixel-by-pixel in this batch.
3. **Empresa column** — plain text, no company-logo initial chip or inline
   "Contratando" badge on the row (the hiring badge only shows via the
   dedicated filter/system view, not inline per-row).
4. **"Agregar filtro" add-flow** — one shared panel listing all 10 filter
   types, not the mockup's per-item dropdown → inline editor. Every filter
   is present, addable, and removable via a working chip; only the
   add-interaction shape differs.
5. **"Seleccionar los N"** — selects everything on the current page (with
   a clarifying banner), not a true server-side "act on every row matching
   the filter" mode — every bulk action here takes an explicit id list.
   **Flagged as needing an owner decision** if true filter-wide bulk action
   is actually wanted.
6. **Bulk "Generar mensajes" cap (25)** and **toolbar "Exportar" cap
   (5,000 rows)** — both stopgap numbers, not spec'd. **Flagged as needing
   owner confirmation.**
7. **Board's toolbar** — kept the general filter/chips toolbar (richer:
   real active filters, not a hardcoded single chip) instead of collapsing
   to the mockup's fixed "Responsable: Yo" chip. The "never show
   own-company people" note is now present; the underlying invariant
   already held everywhere via the identity resolver's ingest-time skip.
8. **Log-meeting/discard board dialogs** open on the record page
   (`/contacts/[id]?openAction=...`), not inline on the board — functionally
   equivalent, not pixel-verified against the mockup's inline dialog markup.

No row was left silently undone. See the per-row "notes" column above for
the full reasoning behind every deviation.

## Batch history

- **04** (`feat/mockup-port-04-columns`): checklist created; "BDs
  conectados" column (table + board + CSV export).
- **05** (`feat/mockup-port-05-lastactivity-sort`): "Última actividad"
  column; Nombre/Última actividad sort, default "Ordenado por Última
  actividad".
- **06** (`feat/mockup-port-06-column-reorder`): drag-and-drop + keyboard
  column reorder; "Restablecer".
- **07** (`feat/mockup-port-07-bulk-generate-messages`): bulk "Generar
  mensajes" wired to the person-scoped generator, capped at 25.
- **08** (`feat/mockup-port-08-new-contact`): "Nuevo contacto" dialog
  through the identity resolver, with duplicate-match handling.
- **09** (`feat/mockup-port-09-filters-backend`): `ContactFilters`/
  `listQueries.ts` extended with the remaining 6 ad-hoc filter types
  (company, market, startupsOnly, roleGroup, bdConnected,
  lastActivityDays); multi-select `status`.
- **09b** (`feat/mockup-port-09b-filters-ui`, chained off 09): removable
  filter chips + "Borrar todo"; toolbar-level "Exportar" (whole filtered
  view, capped); "Seleccionar los N" (page-scoped, documented); board's
  own-company note.
