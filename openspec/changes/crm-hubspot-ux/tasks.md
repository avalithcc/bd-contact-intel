# Tasks: CRM HubSpot UX and Unified Contact

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~5,920 across 18 PRs (Phase 4B added) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 14 (see table below) |
| Delivery strategy | ask-on-risk (resolved: chained) |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No (owner already resolved chain strategy)
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

**Tracker branch**: `feat/crm-hubspot-ux` (draft, no-merge; only this merges to `main`). PR 1 targets the tracker; each later PR targets the immediately previous PR's branch. Owner reviews via Vercel preview deploys.

### Suggested Work Units

| PR | Title | Slice | Base branch | Est. lines | Gate |
|---|---|---|---|---|---|
| 0 | Commit dark-mode removal | precondition | `main` → tracker | ~small | none (precondition for PR 8) |
| 1 | Schema 0013, `bd.role`, `requireAdmin`, audit tables | 0 | tracker | ~220 | none |
| 2 | Identity matcher module + tests | 0 | PR 1 | ~320 | TDD |
| 3 | Collapse planner, dry-run script, `/admin/migration` | 0 | PR 2 | ~380 | **Dry-run report approval** |
| 4 | Fold leads, re-point refs, status backfill | 0b | PR 3 | ~360 | **Dry-run report approval** |
| 4B-1 | Identity resolver core (`planIdentityWrites`/`applyIdentityWrites`) | 0b | PR 4 | ~300 | TDD |
| 4B-2 | Contact/lead live write cutover under `pg_advisory_xact_lock` | 0b | PR 4B-1 | ~260 | TDD |
| 4B-3 | Reference writes (activity/task/signal), status/owner rules | 0b | PR 4B-2 | ~240 | TDD |
| 4B-4 | Catch-up phase (`--phase=catch_up`) | 0b | PR 4B-3 | ~320 | **Dry-run approval** |
| 5 | `deriveStatus`, activity writes, outreach/hiring re-scope | 0b | PR 4B-4 | ~350 | TDD |
| 6 | Merge/unmerge engine + tests | 1 | PR 5 | ~300 | TDD |
| 7 | `/admin/duplicates` UI | 1 | PR 6 | ~280 | **Mockup approval** |
| 8 | App shell, tokens, remove LocaleSwitcher/`en` path | UI | PR 7 | ~300 | **Mockup approval**; requires PR 0 |
| 9 | Record: shell + About pane | 2 | PR 8 | ~350 | **Mockup approval** |
| 10 | Record: timeline filter + log dialogs | 2 | PR 9 | ~350 | **Mockup approval** |
| 11 | Record: associations, admin view, redirects | 2 | PR 10 | ~350 | **Mockup approval** |
| 12 | List: views and filters | 3 | PR 11 | ~350 | **Mockup approval** |
| 13 | List: columns and bulk actions | 3 | PR 12 | ~350 | **Mockup approval** |
| 14 | List: board and import | 3 | PR 13 | ~350 | **Mockup approval** |

## Phase 0: Precondition

- [ ] 0.1 Commit or discard the uncommitted dark-mode removal (`src/lib/theme/*` deletions, `UserMenu.tsx`, page/dictionary edits currently in the working tree) on `main`, before creating the tracker branch. Blocks PR 8.
- [ ] 0.2 Create draft tracker branch `feat/crm-hubspot-ux` off `main` (no-merge until all child PRs land).

## Phase 1: Foundation — Schema & Roles (PR 1, base: tracker)

- [x] 1.1 Write migration `drizzle/0013_unified_person.sql`: `person`, `person_bd_connection`, `person_property_history`, `person_id_map`, `merge_event`, `duplicate_candidate`, `audit_log`, `migration_run`, `saved_view`, plus `person_id`/`actor_bd_id` FK columns on `activity`, `task`, `signal`, `linkedin_scrape_job`.
- [x] 1.2 Add `bd.role text not null default 'bd'` column and seed the owner as `admin`.
- [x] 1.3 Add `requireAdmin()` guard in `src/lib/auth/` reusing `getCurrentBd()`.
- [x] 1.4 Test: `requireAdmin()` rejects non-admin, allows admin (`tests/unit/`).

## Phase 2: Identity Matcher (PR 2, base: PR 1)

- [x] 2.1 RED: write failing tests for `src/lib/identity/matcher.ts` per contact-identity spec scenarios (profile-key auto-merge, verified-email auto-merge, name+company → review, own-company skip, no-email/no-LinkedIn fallback).
- [x] 2.2 GREEN: implement `matcher.ts` with `IdentityIndex` interface and `MatchResult` union (design D3).
- [x] 2.3 RED/GREEN: `mergeProperties(a, b)` pure function — richer/verified/longer wins, ties go to most recent, losers recorded (contact-identity R7).
- [x] 2.4 REFACTOR: extract shared normalization helpers reused from `src/lib/csv.ts` (`normalizeProfileKey`) and `src/lib/ownCompany.ts`.

## Phase 3: Collapse Migration + Dry-Run Gate (PR 3, base: PR 2)

- [x] 3.1 RED/GREEN: migration planner (rows → plan + counts) as a pure function, tested against fixtures (3-BDs-1-profile-key scenario).
- [x] 3.2 `scripts/unify-contacts.ts --phase=collapse --dry-run`: builds in-memory `IdentityIndex`, writes `migration_run` report (auto-merged/flagged/new counts per table), no writes to `person`/`person_bd_connection` outside dry-run mode.
- [x] 3.3 `/admin/migration` page (admin-only, `requireAdmin`): shows latest dry-run report, "Approve dry run" action writing `audit_log(migration_approve)` and `migration_run.approved_by/at`.
- [x] 3.4 `--execute --run=<id>`: refuses if `input_hash` changed or run not approved; snapshot production backup first; tags rows with `migration_run_id`.
- [x] 3.5 **GATE**: owner reviews the collapse dry-run report in `/admin/migration` (against production data via Vercel preview) and records approval before `--execute` runs. (Executed in prod: migration_run b9003aae, kind=collapse, mode=execute.)
- [x] 3.6 Test: dry-run mode never writes `person` rows; execute mode refuses on stale `input_hash` or missing approval.

## Phase 4: Fold Leads (PR 4, base: PR 3)

- [x] 4.1 RED/GREEN: fold planner — leads matched via matcher, unmatched leads become new Contacts carrying `ownerBdId` and source. (`src/lib/migration/foldPlanner.ts`; IdentityIndex seeded from EXISTING `person` rows, since Phase 3 collapse is already executed in prod.)
- [ ] 4.2 RED/GREEN: `status_backfill` activity writer for leads with a manually set status and no supporting activity (contact-migration spec scenario).
- [x] 4.3 `scripts/unify-contacts.ts --phase=fold_leads`: re-points `activity`/`task`/`signal` via `person_id_map` (`linkedin_scrape_job` has no lead-scoped column, so it is not re-pointed here); produces fold dry-run report.
- [ ] 4.4 **GATE**: owner reviews the fold-leads dry-run report before `--execute`.
- [x] 4.5 Test: zero orphaned references after fold execute (fixture-level check); every legacy id resolves via `person_id_map`.

**Actual PR slicing (recorded as it happened, deviates from the plan table above)**:

- 4a — planner (PR #8: `feat/crm-hubspot-ux-04-fold-leads`).
- 4b — collapse-merge planner fix (`feat/crm-hubspot-ux-04b-collapse-merge-fix`). Repair verified unnecessary: dry run against prod showed 0 diffs across all 699 multi-contact groups (identical values in the 8 affected fields), so no `--execute` was needed and no repair CLI shipped.
- 4d — fold-leads write path, this branch (`feat/crm-hubspot-ux-04d-fold-write`).

## Phase 4B: Write Cutover & Catch-up (PRs 4B-1..4B-4, base: PR 4)

- [ ] 4B.1 RED/GREEN: `planIdentityWrites(rows, index)` in `src/lib/identity/resolve.ts` — new/auto/review/own-company outcomes, intra-chunk dedup, merged-survivor resolution (contact-identity "Live ingestion resolves identity").
- [ ] 4B.2 GREEN: `prefetchIdentityIndex(tx, rows)` (3 indexed queries) + `applyIdentityWrites(tx, plan)` with `ON CONFLICT (profile_key) DO NOTHING RETURNING` and re-select of losers. (PR 4B-1, ~300 code)
- [ ] 4B.3 RED/GREEN: `upsertContacts` and `importLeads` run each chunk in one transaction under `pg_advisory_xact_lock`, writing legacy + person + connection + map; `IDENTITY_DUAL_WRITE` kill switch.
- [ ] 4B.4 Test: two concurrent uploads of the same new profile key yield one `person` and two connections. (PR 4B-2, ~260 code)
- [ ] 4B.5 RED/GREEN: `createActivity` (incl. Gmail log), `createTask`/`updateTask`, manual signal set `person_id` + `actor_bd_id` via `person_id_map` subquery.
- [ ] 4B.6 RED/GREEN: `updateLeadStatus` appends `status_change` activity; `updateLeadOwner` applies R3; `recomputeMessageSignals` updates `person_bd_connection`. (PR 4B-3, ~240 code)
- [ ] 4B.7 RED/GREEN: catch-up planner — anti-join input, null-`person_id` re-point, lead/contact drift; `input_hash` over input ids.
- [ ] 4B.8 `--phase=catch_up` dry-run/execute reusing `executionGuard`, `snapshotBackup`, `finalizeExecute` pattern; shown in `/admin/migration`. (PR 4B-4, ~320 code)
- [ ] 4B.9 **GATE**: owner confirms deploy sequence (early partial release vs. two catch-ups), reviews catch-up dry-run, approves before `--execute`.
- [ ] 4B.10 Test: after execute, zero unmapped `contact`/`lead` rows and zero non-own-company references with null `person_id`; re-run reports zero.

## Phase 5: Status Derivation & Re-Scope Reads (PR 5, base: PR 4B-4)

- [ ] 5.1 RED/GREEN: pure `deriveStatus(events)` per the rank/discard algorithm in design.md, returning `{ status, because }`.
- [ ] 5.2 Wire `deriveStatus()` into the same transaction as every activity write, merge, and message import; cache result on `person.status`/`status_activity_id`.
- [ ] 5.3 Re-scope outreach and hiring reads off `bdId` filtering onto the unified `person` table (no `bdId` scoping on Contact queries per proposal success criteria).
- [ ] 5.4 Test: discard un-discarded by a later activity; combined multi-BD activity picks the most advanced stage.

## Phase 6: Merge/Unmerge Engine (PR 6, base: PR 5)

- [ ] 6.1 RED/GREEN: `mergeContacts(survivorId, mergedId, reason, actorBdId)` — writes `merge_event` snapshot + linked `audit_log(merge)` row in one transaction.
- [ ] 6.2 RED/GREEN: `unmergeContact(mergeEventId, actorBdId)` — replays the snapshot in reverse; writes `audit_log(unmerge)`.
- [ ] 6.3 RED/GREEN: `markNotDuplicate(pairId, actorBdId)` — sets `duplicate_candidate.status='not_duplicate'`, writes `audit_log(not_duplicate)`; pair never resurfaces.
- [ ] 6.4 Test: false-merge → unmerge restores both original Contacts fully.

## Phase 7: Duplicate Review UI (PR 7, base: PR 6)

- [ ] 7.1 **GATE**: owner approves `mockups/index.html` duplicate-review screen before this PR's UI code is written.
- [ ] 7.2 `/admin/duplicates` page (admin-only, `requireAdmin`) implementing the approved mockup: pair list, Merge / No es duplicado / Deshacer fusión actions, Spanish copy per GLOSSARY.md.
- [ ] 7.3 E2E: non-admin gets 404 on `/admin/duplicates`; admin merge action produces one `audit_log` row.

## Phase 8: App Shell & Design Tokens (PR 8, base: PR 7; requires Phase 0)

- [ ] 8.1 **GATE**: owner approves the design-system mockup (shell, tokens) covering every screen from `/login` onward.
- [ ] 8.2 Build `Sidebar`/`TopBar` app shell under `src/app/contacts/` per design D9 (not yet extracted to `src/components/`).
- [ ] 8.3 Add status/info/badge-text tokens and darker accent hover to `globals.css`; remove the 14 hardcoded badge hex literals in `companies/[key]/page.tsx` and `leads/[id]/page.tsx`.
- [ ] 8.4 Remove `LocaleSwitcher` usage and the `en` dictionary usage path from the UI (keep the `{ en, es }` dictionary structure per D10); add the `ClientStrings` guard type.
- [ ] 8.5 RED/GREEN: unit test walking dictionary slices to guarantee client components only receive plain strings (`ClientStrings` guard).

## Phase 9: Record — Shell & About (PR 9, base: PR 8)

- [ ] 9.1 **GATE**: owner approves the record-page mockup (three-pane layout).
- [ ] 9.2 `/contacts/[id]` route: left About pane (editable properties, quick actions: note/email/task), showing "last updated by X" per property.
- [ ] 9.3 Spanish copy sourced from `es` dictionary per GLOSSARY.md.
- [ ] 9.4 RED/GREEN: property edit writes `person_property_history` row with `changed_by_bd_id`.

## Phase 10: Record — Timeline & Log Dialogs (PR 10, base: PR 9)

- [ ] 10.1 Middle timeline pane: filterable by activity type; renders `note`, `email_sent`, `hunter_lookup`, `status_change` (read-only), `meeting_logged`, `discarded`, `status_backfill`.
- [ ] 10.2 "Log meeting" dialog (Registrar reunión) writing `meeting_logged` activity.
- [ ] 10.3 "Discard contact" dialog with fixed reason codes (`wrong_profile`/`not_interested`/`other_vendor`/`left_company`/`bad_data`/`other`); `note` required when reason is `other`.
- [ ] 10.4 RED/GREEN: discard reason validation — `other` without a note is rejected.
- [ ] 10.5 Board drag-to-status opens the matching log dialog instead of writing status directly (proposal Implications).

## Phase 11: Record — Associations, Admin View, Redirects (PR 11, base: PR 10)

- [ ] 11.1 Right associations pane: company, connected BDs (`person_bd_connection`), each with its own `connectedOn`.
- [ ] 11.2 Non-admin: shows WHICH BDs have history, never content (R6).
- [ ] 11.3 `getConversationForAdmin(personId, bdId)`: only path for admin content access; writes `audit_log(view_conversation)` before returning content.
- [ ] 11.4 `/leads/[id]` and `/contact/[id]` call `redirect()` after a `person_id_map` lookup; own-company rows (`person_id` null) answer 404.
- [ ] 11.5 E2E: admin viewing another BD's conversation produces exactly one audit row; non-admin cannot read content.

## Phase 12: List — Views & Filters (PR 12, base: PR 11)

- [ ] 12.1 **GATE**: owner approves the contact-list mockup (views as tabs, filters).
- [ ] 12.2 `src/lib/contacts/views.ts`: system views as code constants (All, Mis contactos, Sin contactar, Nuevo con email verificado, Empresas con vacantes, Listo para outreach).
- [ ] 12.3 `saved_view` table CRUD for BD-created views (filters/columns/sort as jsonb).
- [ ] 12.4 RED/GREEN: view filter serialization round-trips through the query string (`?view=`).

## Phase 13: List — Columns & Bulk Actions (PR 13, base: PR 12)

- [ ] 13.1 Column picker (Selector de columnas) with persisted column selection per view.
- [ ] 13.2 Bulk actions (Acciones masivas) on multi-row selection.
- [ ] 13.3 `/leads` and `/outreach` redirect to `/contacts?view=…`; "Generate message" moves to the record page.

## Phase 14: List — Board & Import (PR 14, base: PR 13)

- [ ] 14.1 Table/board toggle by status (`?layout=board`); board covers all Contacts, including LinkedIn-only ones.
- [ ] 14.2 `/contacts/import` moves CSV upload here; shows dedup outcome (auto-merged/flagged/new) using the same matcher as migration.
- [ ] 14.3 E2E: full flow — import → dedup outcome → contact visible in list and board.
