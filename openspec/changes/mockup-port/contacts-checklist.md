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
| "Seleccionar los N" | contacts.html:104 | **done, truly filter-wide (branch 14)** | BulkActionsBar.tsx `selectAllMatching`, src/lib/contacts/bulkTargetIds.ts, listQueries.ts `getContactIdsForFilters` | Owner/task/export now operate on ALL N: `mode=filter` + the same serialized `ContactFilters`/`sort` the toolbar itself uses, re-derived server-side (`getContactListPage(filters, meBdId, q, 1, cap, ...)` — the EXACT same function the list renders from, never a parallel reimplementation), capped at `BULK_FILTER_TARGET_CAP=2000` (owner/task) or `MAX_VIEW_EXPORT_ROWS=5000` (export). "Generar mensajes" stays capped at `MAX_BULK_GENERATE_MESSAGES=25` regardless of N — the existing `wasCapped` banner already says so. The client never computes or sends an id list in this mode. Existing bulk-owner path (`bulkOwnerDb.ts`) does **not** write to `audit_log` today, so per instruction ("if the existing path audits") no new audit write was added for the filter-wide case either — flagging in case this was assumed to already exist. |
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
| Log-meeting dialog on drop-to-Reunión | contacts-board.html:93-105 | **done, inline on the board (branch 15)** | src/app/(app)/contacts/BoardDnD.tsx, `MeetingForm` (exported from `[id]/QuickActions.tsx`, reused rather than duplicated) | After the move-confirm step, the SAME form the record page uses opens inline on the board, calling `logContactMeetingAction` directly — never leaves `/contacts?layout=board`. |
| Discard dialog (mandatory reason) | contacts-board.html:106-121 | **done, inline on the board (branch 15)** | BoardDnD.tsx, `DiscardForm` (reused from `[id]/QuickActions.tsx`) | Same as log-meeting: opens inline, calls `discardContactAction` directly. The "Contactado" drop target (-> email composer) was intentionally NOT converted — only log-meeting/discard were asked to become inline dialogs; email needs record-page context (full address/history) this board card doesn't carry. |

## Summary

Every checklist row that started as "todo" (feature genuinely missing) is
closed, and every previously-documented UX-shape deviation the owner asked
to close (branches 11-15) is now closed too, PLUS a prod bug fix (branch
10). What remains is a small, deliberately-kept set:

1. **Board's toolbar** (kept, per explicit instruction) — the general
   filter/chips toolbar (richer: real active filters, not a hardcoded
   single "Responsable: Yo" chip) instead of collapsing to the mockup's
   fixed chip. The "never show own-company people" note is present; the
   underlying invariant already holds everywhere via the identity
   resolver's ingest-time skip.
2. **Stopgap caps, kept as-is** (per explicit instruction; owner is
   raising these separately) — bulk "Generar mensajes" (25), toolbar/
   filter-wide "Exportar" (5,000 rows), filter-wide owner/task
   (`BULK_FILTER_TARGET_CAP` = 2,000).
3. **"Agregar filtro" add-flow** — a real dropdown of the mockup's 10
   options -> per-item inline editor (branch 13), but industryGroup/
   seniority (pre-existing, not in the mockup's 10) are kept addable in a
   second "more filters" group rather than silently dropped.
4. **Audit log** — the existing bulk-owner path does not write to
   `audit_log` today, so per instruction ("if the existing path audits")
   no new audit write was added for the filter-wide case either (branch
   14) — flagging in case this was assumed to already exist.
5. **Company column** — logo chip + inline "Contratando" badge now done
   (branch 12); still no company-record-page-style extra detail beyond
   what the mockup itself shows.

No row was left silently undone. See the per-row "notes" column above for
the full reasoning behind every remaining item.

## Prod bugs fixed (branches 10, 16)

**Branch 10**: "Última actividad" (column, sort, and the
`lastActivityDays` filter) used `activity.created_at` for
`status_backfill` rows (migration reconstructions) instead of
`metadata.originalAt` — every backfill imported on the same day read as
active that day, matching `lastActivityDays=30` and sorting to the top of
the default list regardless of when the event actually happened. Fixed
with one shared `effectiveActivityAtSql()` CASE expression, used
consistently everywhere "last activity" is read or sorted or filtered —
see src/lib/contacts/effectiveActivityTime.ts for the pure rule it
mirrors (same as src/lib/status/deriveStatus.ts's status-derivation
rule).

**Branch 16** (owner's prod smoke test at 3e31603 found two more, both
would have 500'd or crashed in prod, missed by branch 10's unit tests):

1. **CRASH**: the `lastActivityDays` EXISTS filter interpolated a raw JS
   `Date` (`since`) directly into a `sql\`...\`` tagged template.
   postgres-js's raw-template driver only accepts string/number/boolean/
   null/Buffer/ArrayBuffer for an interpolated value — never a `Date`
   object (that conversion only exists for drizzle's typed column helpers
   like `gte()`) — so every `?...lastActivityDays=N` request threw `The
   "string" argument must be of type string or an instance of Buffer or
   ArrayBuffer. Received an instance of Date` and 500'd. Fixed by
   extracting `buildSinceIso(days, now)` (src/lib/contacts/
   effectiveActivityTime.ts) — day-arithmetic + `.toISOString()` as one
   pure, unit-tested function — and interpolating that string with an
   explicit `::timestamptz` cast (`${sinceIso}::timestamptz`) instead of
   the bare Date. Every other raw `sql\`` template in
   src/lib/contacts/listQueries.ts (the only file with any) was
   re-checked; none interpolates a `Date` — see the apply-progress
   report's full per-file list.
2. **TYPE**: `attachDerivedColumns`'s DISTINCT ON activity pick selects
   `createdAt` as a raw computed `sql<Date>` expression
   (`effectiveActivityAtSql()`), not a plain column reference — postgres-js
   returns a computed timestamptz expression's wire value as a STRING at
   runtime (e.g. `"2026-09-25 13:30:00+00"`), not a parsed `Date`, the same
   class of bug src/lib/outreach/queries.ts already normalizes
   `lastMessageAt` for. `LastActivityRawRow.createdAt` retyped to
   `Date | string`; `buildLastActivityEntries` (src/lib/contacts/
   lastActivity.ts) is the single place this gets coerced
   (`new Date(...)`) into a real `Date` — every consumer (the relative-
   time render in page.tsx, CSV export's `.toISOString()` call) reads the
   already-normalized `LastActivityEntry.createdAt` and needed no changes.
   Checked and confirmed no-op for: the board (doesn't render
   `lastActivity` at all) and sort (`lastActivityAgg`'s value is only ever
   used inside a SQL `ORDER BY` expression, never pulled into JS).

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
  view, capped); "Seleccionar los N" (page-scoped at the time); board's
  own-company note.
- **10** (`feat/mockup-port-10-lastactivity-bugfix`): prod bug fix — see
  "Prod bug fixed" above.
- **11** (`feat/mockup-port-11-save-view-modal`): "Guardar vista" rebuilt
  as a real modal (shared Dialog) with the mockup's "Incluye"
  chip/columns-count summary.
- **12** (`feat/mockup-port-12-company-logo-hiring-badge`): Empresa
  column's company-logo chip + inline "Contratando" badge (reuses
  `getHiringMatchIndex()`, one call per page).
- **13** (`feat/mockup-port-13-filter-menu-editors`): "Agregar filtro"
  reworked into a real dropdown -> per-item inline editor; the two
  previously-stacked toolbar rows merged into one (table view only, board
  toolbar kept as-is).
- **14** (`feat/mockup-port-14-filter-wide-bulk-actions`): "Seleccionar los
  N" made genuinely filter-wide for owner/task/export (capped), reusing
  `getContactListPage` itself (never a parallel query) to guarantee the
  filter-derived id set matches what the list shows.
- **15** (`feat/mockup-port-15-board-inline-dialogs`): log-meeting/discard
  dialogs now open inline on the board (shared Dialog, same server
  actions as the record page), not via navigation.
