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
- [x] 4.2 RED/GREEN: `status_backfill` activity writer for leads with a manually set status and no supporting activity (contact-migration spec scenario). (`planStatusBackfills` in `src/lib/migration/foldPlanner.ts`; no DB migration needed — `activity.type` is free text, not an enum.)
- [x] 4.3 `scripts/unify-contacts.ts --phase=fold_leads`: re-points `activity`/`task`/`signal` via `person_id_map` (`linkedin_scrape_job` has no lead-scoped column, so it is not re-pointed here); produces fold dry-run report.
- [ ] 4.4 **GATE**: owner reviews the fold-leads dry-run report before `--execute`.
- [x] 4.5 Test: zero orphaned references after fold execute (fixture-level check); every legacy id resolves via `person_id_map`.

**Actual PR slicing (recorded as it happened, deviates from the plan table above)**:

- 4a — planner (PR #8: `feat/crm-hubspot-ux-04-fold-leads`).
- 4b — collapse-merge planner fix (`feat/crm-hubspot-ux-04b-collapse-merge-fix`). Repair verified unnecessary: dry run against prod showed 0 diffs across all 699 multi-contact groups (identical values in the 8 affected fields), so no `--execute` was needed and no repair CLI shipped.
- 4d — fold-leads write path (`feat/crm-hubspot-ux-04d-fold-write`): planner + write rows + run orchestration, wired to the database.
- 4e — fold-leads CLI wiring (`feat/crm-hubspot-ux-04e-fold-cli`): `--phase=fold_leads` reaches the real database via `scripts/unify-contacts.ts`; re-pointing scope docs fix (no `linkedin_scrape_job` column).
- 4f — status backfill + admin UI (`feat/crm-hubspot-ux-04f-fold-backfill-admin`): task 4.2's `status_backfill` writer, and `/admin/migration` extended to list/approve `fold_leads` runs alongside `collapse`.

## Phase 4B: Write Cutover & Catch-up (PRs 4B-1..4B-4, base: PR 4)

- [x] 4B.1 RED/GREEN: `planIdentityWrites(rows, index)` in `src/lib/identity/resolve.ts` — new/auto/review/own-company outcomes, intra-chunk dedup, merged-survivor resolution (contact-identity "Live ingestion resolves identity").
- [x] 4B.2 GREEN: `prefetchIdentityIndex(tx, rows)` (3 indexed queries) + `applyIdentityWrites(tx, plan)` in `src/lib/identity/resolveDb.ts` with `ON CONFLICT (profile_key) DO NOTHING RETURNING` and re-select of losers. (PR 4B-1, ~300 code)
- [x] 4B.3 RED/GREEN: `upsertContacts` and `importLeads` run each chunk in one transaction under `pg_advisory_xact_lock`, writing legacy + person + connection + map; `IDENTITY_DUAL_WRITE` kill switch. Implemented as `src/lib/identity/ingestWrite.ts` (pure legacy-row → `IdentityIngestRow` mappers + `runIdentityCutoverChunk` injected-ports orchestration, ordering unit-tested with fakes) wired into `upsertContacts`/`importLeads`: each chunk runs in `db.transaction`, legacy upsert FIRST, then `withIdentityLock` wraps ONLY prefetch/plan/apply (matches design D14's literal ordering; lock is skipped entirely when a chunk has no identity rows). `.returning()` is only appended to the legacy upsert on the dual-write-on branch, so the kill-switch-off path stays the exact original statement (D11: byte-identical legacy write, including query text). Leads with no resolved `ownerBdId` are intentionally left out of the identity rows for a chunk (nothing to connect); the catch-up planner (4B.7, not yet built) is the intended way to re-point them once an owner is assigned.
- [x] 4B.4 Test: two concurrent uploads of the same new profile key yield one `person` and two connections. (PR 4B-2, ~260 code) Implemented as a fake-level test (`tests/unit/identityIngestWrite.test.ts`, "4B.4: two concurrent uploads..."): two sequential calls to `runIdentityCutoverChunk` share an in-memory fake person store that enforces `profile_key` uniqueness + `ON CONFLICT DO NOTHING` the same way `applyIdentityWrites` does, reusing the real `buildIdentityWriteRows`/`repointIdentityWriteRows`. **A real-DB concurrency test (two genuinely parallel transactions) is not possible in this unit-test environment** (no DATABASE_URL, `tests/unit` is `node:test` + fakes only) — this is a fake-level proof that the plan/repoint logic converges to one person + two connections when replayed against a store with the same conflict semantics as Postgres. Leave the real-DB race as an owner/staging verification note before `--execute`/production dual-write is trusted at scale.
- [x] 4B.5 RED/GREEN: `createActivity` (incl. Gmail log), `createTask`/`updateTask`, manual signal set `person_id` + `actor_bd_id` via `person_id_map` subquery. Implemented as a pure `resolvePersonIdLookup` (`src/lib/identity/referenceWrite.ts`, unit-tested) picking the row's legacy subject (contact takes precedence over lead; company-only rows have nothing to map), plus a thin `personIdLookupSql` subquery builder (`src/lib/identity/resolveDb.ts`). Wired into `createActivity`/`createTask`/`updateTask` (`src/lib/activity/queries.ts`, `src/lib/tasks/queries.ts`) and the manual signal route (`src/app/api/signals/manual/route.ts`), all gated by `isIdentityDualWriteEnabled()`. `actor_bd_id` set at the call sites that know the acting BD (`src/app/activity/actions.ts#createActivityAction`, `src/app/tasks/actions.ts#createTaskAction`, the manual signal route). `updateTask` only re-resolves `person_id` when the update itself changes `leadId`/`contactId` (no current caller does, but the query layer supports it per design). No matcher, no advisory lock — these paths never create a person; an unmapped legacy row (created before catch-up) leaves `person_id` null, same as importLeads' owner-less leads (4B.3).
- [x] 4B.6 RED/GREEN: `updateLeadStatus` appends `status_change` activity; `updateLeadOwner` applies R3; `recomputeMessageSignals` updates `person_bd_connection`. (PR 4B-3, ~240 code) Implemented in `src/lib/leads/queries.ts`: `updateLeadStatus` uses a pure `planStatusChangeActivity` (`src/lib/leads/statusChange.ts`, unit-tested: a real status edit produces `{status}` metadata, a notes-only call produces nothing) and, when dual-write is on, appends a `status_change` activity carrying `person_id` (via the same `personIdLookupSql` subquery) and `actor_bd_id` in the same transaction as the legacy `lead` update. `updateLeadOwner` wraps the legacy update and a raw-SQL R3 gate in one transaction: `person.owner_bd_id` is only overridden when the mapped person has zero `person_bd_connection` rows (`NOT EXISTS`), and a `person_property_history` row is written alongside it; when the person already has a connection, R3 (earliest LinkedIn connector) stands and the edit is silently a no-op on the person side (legacy `lead.ownerBdId` still updates). `recomputeMessageSignals` (`src/lib/queries.ts`) gets a third set-based `UPDATE person_bd_connection … FROM peer_agg JOIN contact JOIN person_id_map`, gated by the kill switch, mirroring the existing `contact` aggregate update. The R3 gate and the `person_bd_connection` update are DB-only raw SQL (same "can't unit-test without DATABASE_URL" convention as the rest of this write-cutover's thin DB layer, per 4B.3/4B.4); only the pure planning pieces (`resolvePersonIdLookup`, `planStatusChangeActivity`) are unit-tested.
- [x] 4B.7 RED/GREEN: catch-up planner — anti-join input, lead/contact drift; `input_hash` over input rows. Implemented as `src/lib/migration/catchUpPlanner.ts#planCatchUp(input, existingPersons)` (pure, unit-tested — `tests/unit/catchUpPlanner.test.ts`), reusing `planIdentityWrites` (design D12) and the exact same legacy-row → `IdentityIngestRow` mappers the live cutover uses (`ingestWrite.ts`'s `contactRowsToIdentityRows`/`leadRowsToIdentityRows`), so catch-up can't drift from live-path field mapping. The caller (4B.8) is responsible for querying the anti-join AND drifted rows (leads by `updated_at`, contacts via the existing diff core) and passing both in the same row shape — a drifted row that still matches its existing person's identity keys is planned as an ordinary "auto" update, no special-casing needed. Leads with no resolved owner are excluded from the plan (same decision `leadRowsToIdentityRows` already makes for live ingestion — `bdId` is required for `person_bd_connection`); `leadsSkippedNoOwner` reports how many, so they're visibly still-unmapped rather than silently dropped. `input_hash` (`computeCatchUpInputHash` in `inputHash.ts`) is reflective over every field of every contact/lead row AND the existing-person snapshot the plan was matched against (same rationale as `computeFoldInputHash`). The null-`person_id` reference re-point (`UPDATE … FROM person_id_map`) is a straight set-based SQL join with nothing to plan — deferred to 4B.8's DB layer.
- [ ] 4B.8 `--phase=catch_up` dry-run/execute reusing `executionGuard`, `snapshotBackup`, `finalizeExecute` pattern; shown in `/admin/migration`. (PR 4B-4, ~320 code) — NOT YET IMPLEMENTED; split into a follow-up branch (`feat/crm-hubspot-ux-04B4b-catch-up-cli`) per the review-budget guard, so this PR (`feat/crm-hubspot-ux-04B4-catch-up`) stays the pure planner + tests slice.
- [ ] 4B.9 **GATE**: owner confirms deploy sequence (early partial release vs. two catch-ups), reviews catch-up dry-run, approves before `--execute`.
- [ ] 4B.10 Test: after execute, zero unmapped `contact`/`lead` rows and zero non-own-company references with null `person_id`; re-run reports zero. Fixture-level coverage landed with 4B.7 (`tests/unit/catchUpPlanner.test.ts`: applying a plan's `buildIdentityWriteRows` output maps every non-skipped row, and re-running `planCatchUp` on an empty anti-join input yields an empty plan) — the real-DB assertion (after `--execute`, zero unmapped rows in the actual `contact`/`lead` tables and zero null-`person_id` references) still needs 4B.8's DB wiring before it can run.

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
