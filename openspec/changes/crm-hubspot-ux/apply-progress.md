# Apply Progress: CRM HubSpot UX and Unified Contact

**Mode**: Strict TDD (`npm run test:unit`, node:test via tsx)
**Batch**: 1 of N — PR 1 (schema) and PR 2 (identity matcher), per the orchestrator's scoped instruction.
**Delivery**: chained PRs, `feature-branch-chain`. Tracker branch `feat/crm-hubspot-ux` (== `main` @ `ea8f55e`), not pushed further in this batch.

## Completed Tasks

- [x] 0.1 Dark-mode removal precondition — already committed on `main` (`05bc307`) before the tracker branch existed. No new work needed.
- [x] 0.2 Tracker branch precondition — already existed and pushed, equal to `main` at `ea8f55e`. No new work needed.
- [x] 1.1 Migration `drizzle/0013_unified_person.sql`: `person`, `person_bd_connection`, `person_property_history`, `person_id_map`, `merge_event`, `duplicate_candidate`, `audit_log`, `migration_run`, `saved_view` tables, plus `person_id`/`actor_bd_id` columns on `activity`, `task`, `signal`, `linkedin_scrape_job`.
- [x] 1.2 `bd.role text not null default 'bd'` column; migration seeds `cristian@avalith.net` as `admin` (owner = first admin, R5).
- [x] 1.3 `requireAdmin()` guard in `src/lib/auth/requireAdmin.ts`, split from a pure `assertAdminRole()` in `src/lib/auth/adminRole.ts` (kept DB-import-free so it's unit-testable without `DATABASE_URL`).
- [x] 1.4 Test: `tests/unit/requireAdmin.test.ts` — admin allowed, non-admin/null/unrecognized role rejected.
- [x] 2.1 RED: `tests/unit/identityMatcher.test.ts` written first against `@/lib/identity/matcher` (module did not exist — confirmed `MODULE_NOT_FOUND` failure before implementing).
- [x] 2.2 GREEN: `src/lib/identity/matcher.ts` — `matchIdentity()`, `IdentityIndex`, `MatchResult` per design D3 and the contact-identity precedence order.
- [x] 2.3 RED/GREEN: `mergeProperty()`/`mergeProperties()` in the same file — non-null over null, explicit specificity override (`emailStatusRank`) for verified-over-probable, default length-based specificity for "richer title", ties broken by `updatedAt`, losers recorded.
- [x] 2.4 REFACTOR: matcher reuses `normalizeProfileKey` (`@/lib/csv`), `normalizeCompanyKey` (`@/lib/companyCategories`), `ownCompanyMatchReason`/`splitEmail` (`@/lib/ownCompany`, `@/lib/emailPatterns`) — no duplicated normalization logic.

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `drizzle/0013_unified_person.sql` | Created | Generated via `drizzle-kit generate` from the schema below, then hand-hardened: added `IF NOT EXISTS` to every `ADD COLUMN` (the repo's majority convention — see 0012 finding below) and appended the owner-admin seed `UPDATE`. |
| `src/db/schema.ts` | Modified | Added `bd.role`; added `person`, `personBdConnection`, `personPropertyHistory`, `personIdMap`, `mergeEvent`, `duplicateCandidate`, `auditLog`, `migrationRun`, `savedView` tables; added `personId`/`actorBdId` columns + indexes to `activity`, `task`, `signal`, `linkedinScrapeJob`. |
| `src/lib/tasks/queries.ts` | Modified | Added `personId`/`actorBdId` to the three explicit `TaskRow` column projections (`getTasks`, `getOpenTasks`, `getOverdueTasks`) so they satisfy the widened `Task` type. No behavior change. |
| `src/lib/auth/adminRole.ts` | Created | Pure `assertAdminRole()` + `AdminRequiredError`, no DB import. |
| `src/lib/auth/requireAdmin.ts` | Created | `requireAdmin()` wrapper — calls `getCurrentBd()` then `assertAdminRole()`. |
| `tests/unit/requireAdmin.test.ts` | Created | 4 tests for `assertAdminRole`. |
| `src/lib/identity/matcher.ts` | Created | `matchIdentity()`, `IdentityIndex`, `MatchResult`, `mergeProperty()`, `mergeProperties()`, `emailStatusRank()`, `buildNameCompanyKey()`. |
| `tests/unit/identityMatcher.test.ts` | Created | 17 tests covering every contact-identity spec scenario plus merge-property edge cases. |

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.3/1.4 `requireAdmin`/`assertAdminRole` | Wrote `tests/unit/requireAdmin.test.ts` against non-existent `@/lib/auth/requireAdmin` — confirmed `MODULE_NOT_FOUND`. First implementation attempt imported `getCurrentBd` directly into the tested module, which transitively pulled in `src/db/index.ts` and failed at import time (`DATABASE_URL is not set`) — this is itself a RED signal (the test *can't even load*), not a passing/failing assertion. | Split into `adminRole.ts` (pure, no DB import) + `requireAdmin.ts` (DB wrapper); re-ran — 4/4 pass. | Re-exported `AdminRequiredError`/`assertAdminRole` from `requireAdmin.ts` for callers that only need the guard, not the split. |
| 2.1/2.2 `matchIdentity` | Wrote `tests/unit/identityMatcher.test.ts` (17 cases) against non-existent `@/lib/identity/matcher` — confirmed `Cannot find module`. | Implemented `matcher.ts`; all 17 passed on first run. | N/A — no rework needed; reuse (task 2.4) was designed in from the start rather than retrofitted. |
| 2.3 `mergeProperty`/`mergeProperties` | Same test file as above (written before implementation). | Same implementation pass — all merge-property cases passed on first run. | N/A |

No task in this batch was implemented without a failing test written first for its pure-logic surface. `requireAdmin()` itself (the DB-calling wrapper) is not unit-tested here — only its pure predicate is — since it has no branching logic beyond delegating to `assertAdminRole`; DB-backed integration coverage is deferred to Phase 7's E2E task (7.3).

## Test Results

```
$ npm run test:unit
ℹ tests 49
ℹ pass 49
ℹ fail 0

$ npm run typecheck
(no output — clean)
```

## Deviations from Design

- **Person id/audit FKs on `activity`/`task`/`signal`/`linkedin_scrape_job`**: design.md lists `person_id`/`actor_bd_id` generically for all four tables. `task` already has `assignedToBdId` ("who owns it"); `actorBdId` was added anyway as "who created/logged it", per the literal instruction in tasks.md 1.1, since the two concepts are distinct (assignee vs. logger) and design did not carve out an exception for `task`.
- **No DB foreign key on `person.mergedIntoId`**: kept as a plain `uuid` column (indexed, no `.references()`) to avoid a same-table self-referencing FK defined at `CREATE TABLE` time. Enforcement is deferred to `mergeContacts()`/`unmergeContact()` in Phase 6, consistent with the existing repo convention of not FK-constraining cross-cutting id columns (e.g. `activity.contactId` has no FK either, "checked at application level").
- **`person.statusActivityId` and `person.sourceKey`/`migrationRunId`**: kept as plain `uuid`/`text` columns with no FK, matching the "don't rewrite history" rationale already used elsewhere in this schema (e.g. `board_candidate.decidedBy`).
- Everything else matches design.md's data model table and the contact-identity/admin-access-audit specs as written.

## Issues Found — Migration 0012 ledger safety (explicitly requested finding)

**Finding: `drizzle-kit migrate` is likely UNSAFE to run against production as-is, independent of this change.**

- `drizzle/0012_fantastic_iceman.sql` creates 4 new tables with `CREATE TABLE IF NOT EXISTS` (idempotent, safe) and adds FK constraints via the repo's standard `DO $$ ... EXCEPTION WHEN duplicate_object THEN null END $$` guard (idempotent, safe) and indexes via `CREATE INDEX IF NOT EXISTS` (idempotent, safe).
- However, the three `ALTER TABLE "contact" ADD COLUMN ...` statements in 0012 (`email_status`, `email_confidence`, `email_source`) do **NOT** use `IF NOT EXISTS`, unlike 9 of the other 11 migrations in `drizzle/` that add columns (0000, 0001, 0003, 0004, 0006, 0007, 0008 all use `ADD COLUMN IF NOT EXISTS`; only 0010 and 0012 omit it).
- You told me the drizzle ledger (`__drizzle_migrations` in prod) is missing the 0012 entry even though 0012's tables already exist in prod. That means those `contact` columns almost certainly already exist in prod (created whenever 0012 was actually applied, e.g. via `drizzle-kit push` or a manual run), but the ledger doesn't know 0012 ran.
- If `drizzle-kit migrate` is run later, it will see 0012 as "not yet applied" (per the ledger) and re-execute its SQL, including the non-idempotent `ADD COLUMN` statements. Postgres will raise `column "email_status" of relation "contact" already exists` and the migration will fail (and depending on transaction wrapping, could abort mid-migration).
- **I did not modify `drizzle/0012_fantastic_iceman.sql`** — you asked me to check, not fix it silently. Recommended fix (not applied): either (a) hand-add `IF NOT EXISTS` to those three lines in 0012 so it becomes a safe no-op replay, or (b) manually insert the missing 0012 row into `__drizzle_migrations` in prod (with the correct hash/timestamp) so `migrate` never tries to replay it. Either requires a deliberate decision by you before the next `migrate` run — I have not run any migration or touched the database.
- **This new migration, 0013, does not have this problem**: I added `IF NOT EXISTS` to all 9 of its `ADD COLUMN` statements by hand after `drizzle-kit generate` produced them without it (generate's default output matched 0012's pattern, not the majority convention). 0013's `CREATE TABLE`/constraint/index statements were already idempotent by default (drizzle-kit's standard output).
- Separately: `drizzle/meta/` is `.gitignore`d in this repo (`.gitignore` line 7). This means `_journal.json`/snapshot files are never committed — each environment (including CI/Vercel, if it runs `migrate`) regenerates or relies on a local copy of `drizzle/meta/`. This is a plausible root cause of the ledger/reality mismatch you described, and is worth a decision (commit `drizzle/meta/` or standardize how it's provisioned per environment) — I did not change `.gitignore` since that's a deployment/process decision outside this batch's scope.

## Review Workload / PR Boundary

| PR | Branch | Base | Files | Diff (`git diff --stat` vs base) | Budget |
|---|---|---|---|---|---|
| PR 1 | `feat/crm-hubspot-ux-01-schema` | `feat/crm-hubspot-ux` (tracker, `ea8f55e`) | `drizzle/0013_unified_person.sql`, `src/db/schema.ts`, `src/lib/tasks/queries.ts` | **781 insertions**, 0 deletions, 6 files (2 commits) | **OVER budget** — ~2x the 400-line target. |
| PR 2 | `feat/crm-hubspot-ux-02-matcher` | `feat/crm-hubspot-ux-01-schema` | `src/lib/identity/matcher.ts`, `tests/unit/identityMatcher.test.ts` | **401 insertions**, 0 deletions, 2 files (1 commit) | At budget (1 line over; not material). |

**PR 1 budget overage — flagged per the "stop and report" instruction, not silently absorbed:**

tasks.md forecast PR 1 at ~220 lines; actual is 781. The gap is structural, not scope creep:
- The generated SQL for 9 new tables + 4 altered tables + all their FK/index statements is inherently verbose under this repo's idempotent `DO $$ ... EXCEPTION ... END $$` pattern for every single constraint (drizzle-kit's own boilerplate, not something I added) — 324 lines.
- `src/db/schema.ts` additions are 381 lines, and this repo's own convention (see every existing table in that file) is heavy per-column/per-table doc comments explaining intent — matching that convention on 9 new tables costs real lines. A comment-free version would be far shorter but would violate "match existing code patterns and conventions."
- This maps to the chained-pr skill's explicit decision gate: **"Generated/vendor/migration diff cannot split cleanly → Ask maintainer for `size:exception`."** Splitting one additive migration file across multiple PRs (e.g. "5 tables in PR 1a, 4 tables + FK columns in PR 1b") would fragment review of a single atomic schema change and risk an inconsistent intermediate state (e.g. FK columns added before their target table exists) — I did not do this without asking.

**Recommendation to the orchestrator**: grant `size:exception` for PR 1 specifically (schema/migration-only, no business logic, every table has a 1:1 line in design.md's data model table for cross-checking), OR ask me to resubmit PR 1 with comments trimmed to a minimum (I estimate this could get it to roughly 450-500 lines, still over budget, since the SQL boilerplate alone is 324 lines and not compressible without losing the idempotency guards). I did not push either branch or open any PR — both are local commits only, per your instruction, awaiting your review/decision.

## Post-review fixes (PR 2, second commit)

Fresh review found PR 1 safe (no confirmed issues) and PR 2 correct but flagged two gaps, fixed as a new commit `2587a76` on `feat/crm-hubspot-ux-02-matcher` (strict TDD, still not pushed):

1. **Accent folding**: `buildNameCompanyKey` only trimmed/lowercased the name half, so "José García" and "Jose Garcia" at the same company produced different review keys (the company half was already accent-folded via `normalizeCompanyKey`). Fixed by reusing `normalizeNameKey` (`src/lib/leads/csv.ts`, now `export`ed — it already did the exact NFKD accent-fold + whitespace-collapse needed, so no new duplicate helper was added). Added tests for accented names, ñ/ü, and extra internal/trailing whitespace.
2. **Conflicting strong matches**: `matchIdentity()` previously returned `kind: "auto"` on a profile-key hit even when a verified-email hit on the *same row* pointed at a different Contact (profile key checked first, function returned early). Now both keys are resolved before deciding: same person on both → still `auto` (`key: "profile_key"`); different people → `{ kind: "review", reason: "conflicting_strong_keys", candidates: [profileMatch, emailMatch] }`, routing to the admin duplicate-review queue instead of silently merging. Added tests for the same-person and conflicting-person cases, plus an email-whitespace-trimming test. Updated `specs/contact-identity/spec.md` with a new "Conflicting strong-key matches are never auto-merged" requirement and two scenarios (agree → auto-merge, disagree → review).

RED confirmed before each fix: the conflicting-keys test failed with `actual: { kind: 'auto', ... }` against the old code, and the accent tests failed with the accented string still present in the key, before either fix was implemented.

`npm run test:unit`: 54/54 pass. `npm run typecheck`: clean.

**PR 2 diff grew from 401 to 509 changed lines** (`git diff --stat` vs. `feat/crm-hubspot-ux-01-schema`: 4 files, 507 insertions + 2 deletions) — now also over the 400-line budget, driven by the doc-comment-heavy spec/test additions the fixes required (test file alone is 262 lines added, matching the existing file's one-scenario-per-test style). Flagging for the same `size:exception` decision as PR 1, or a request to trim.

---

# Batch 2 — Phase 3 (PR 3): Collapse Migration + Dry-Run Gate

**Mode**: Strict TDD (`npm run test:unit`, node:test via tsx).
**Branch**: `feat/crm-hubspot-ux-03-collapse`, created from `feat/crm-hubspot-ux-02-matcher` (head `0555572`). Not pushed; no PR opened.
**Delivery**: chained PRs, `feature-branch-chain`, per the orchestrator's scoped instruction (PR 3 only, this batch).
**Hard safety rule followed**: no migration, script, or dry run was executed against any database — the collapse planner is exercised only through in-memory fixtures in `tests/unit/`.

## Completed Tasks

- [x] 3.1 RED/GREEN: `src/lib/migration/collapsePlanner.ts#planCollapse` — pure function, rows → plan + per-table report. Streams rows through the existing `matchIdentity`/`mergeProperty` (`@/lib/identity/matcher`, reused verbatim, no duplicated normalization) over a growing in-memory `IdentityIndex`. Tested against the contact-migration spec's "3-BDs-1-profile-key" scenario plus own-company skip, name+company review, conflicting-key review, and unparseable-`connectedOn` owner-selection fixtures (`tests/unit/collapsePlanner.test.ts`, 8 tests).
- [x] 3.2 `scripts/unify-contacts.ts --phase=collapse --dry-run`: reads all `contact` rows (keyset-paginated, same pattern as `scripts/backfill-*.ts`), runs `runCollapseDryRun` (`src/lib/migration/collapseRun.ts`), writes one `migration_run` report row. Its ports type (`Pick<CollapseRunPorts, "saveMigrationRun">`) structurally excludes `writePersons`, so a dry run cannot reach the person writer even by mistake — not just "doesn't call it today."
- [x] 3.3 `/admin/migration` page (`src/app/admin/migration/page.tsx`) — first admin-only route in the app. `requireAdmin()` guard; `AdminRequiredError` → `notFound()` (404, not 403, per design.md "Routes"). Shows the latest collapse report, an "Approve dry run" form (`src/app/admin/migration/actions.ts#approveMigrationRunAction` → `approveMigrationRun` writes `migration_run.approved_by/at` + one `audit_log(migration_approve)` row in a transaction), and run history with the approver's name (left-joined, not a raw bd id).
- [ ] 3.4 `--execute --run=<id>` — **partially done**, see Deviations below.
- [ ] 3.5 GATE — owner action against production data (Vercel preview), not something I can do from this batch.
- [x] 3.6 Test: `tests/unit/collapseRun.test.ts` — dry run never calls `writePersons` (4 tests: dry-run saves+never-writes, execute refuses on stale hash, execute refuses when unapproved, execute writes once approved+hash-matches).

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `src/lib/migration/collapsePlanner.ts` | Created | Pure `planCollapse()` — matcher-driven grouping, property merge (email fields move together as one unit — see file comment), owner selection, per-table report. |
| `src/lib/migration/connectedOn.ts` | Created | `parseConnectedOnDate()` — parses LinkedIn's `"12 Mar 2021"` text; null (sorts last) for anything else, including impossible calendar dates. |
| `src/lib/migration/inputHash.ts` | Created | `computeCollapseInputHash()` — sha256 over sorted, field-delimited rows; order-independent, content-sensitive. |
| `src/lib/migration/executionGuard.ts` | Created | `assertExecutionAllowed()` — the R10/R13 owner gate (not found / not approved / stale hash), each a distinct `MigrationExecutionBlockedError.reason`. |
| `src/lib/migration/collapseRun.ts` | Created | `runCollapseDryRun`/`runCollapseExecute` — mode-branching orchestration; dry run's ports type excludes `writePersons`. |
| `src/lib/migration/queries.ts` | Created | DB wiring (not unit-tested — imports `@/db`, same split rationale as `requireAdmin`/`adminRole`): `readAllContactRows`, `saveMigrationRun`, `getMigrationRunForGate`, `listMigrationRuns`/`getLatestMigrationRun` (with approver-name join), `approveMigrationRun`, `writeCollapsePlan`. |
| `scripts/unify-contacts.ts` | Created | CLI: `--phase=collapse --dry-run` / `--execute --run=<id>`. `--phase=fold_leads` explicitly throws "not implemented yet" (Phase 4). `snapshotBackup()` always throws — see Deviations. |
| `src/app/admin/migration/page.tsx` | Created | RSC: latest report, approve form, run history. Existing shared classes only (`panel`/`eyebrow`/`soft`/`muted`/`table-wrap`/`filter-submit`) — no new CSS. |
| `src/app/admin/migration/actions.ts` | Created | `"use server"` `approveMigrationRunAction`. |
| `src/lib/i18n/dictionaries/es.ts`, `en.ts` | Modified | Added a `migration` section to both (type parity — `Dictionary = typeof en`). The page always renders `es` directly, ignoring the locale cookie (R11: new screens are Spanish-only now, not at the PR 8 cutover). `en`'s copy is unused dead weight until PR 8 removes the dual-dictionary structure — flagged, not hidden. |

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 3.1 `parseConnectedOnDate` | `tests/unit/connectedOn.test.ts` written against non-existent `@/lib/migration/connectedOn` — confirmed `Cannot find module`. | Implemented; all 7 cases passed on first run. | N/A |
| 3.1 `computeCollapseInputHash` | `tests/unit/migrationInputHash.test.ts` against non-existent module — confirmed `Cannot find module`. | Implemented; all 4 cases passed on first run. | N/A |
| 3.1/3.6 `assertExecutionAllowed` | `tests/unit/migrationExecutionGuard.test.ts` against non-existent module — confirmed `Cannot find module`. | Implemented; all 4 cases passed on first run. | N/A |
| 3.1 `planCollapse` | `tests/unit/collapsePlanner.test.ts` (8 cases, including the spec's 3-BD scenario) against non-existent module — confirmed `Cannot find module`. | Implemented; all 8 passed on first run — required one fixture fix mid-authoring (a "report buckets sum to rowsRead" fixture accidentally had two rows collide on name+company across the wrong groups; fixed the fixture, not the implementation, before it was ever run — this was caught while writing the test, not a RED/GREEN cycle against wrong code). | N/A |
| 3.6 `runCollapseDryRun`/`runCollapseExecute` | `tests/unit/collapseRun.test.ts` (4 cases) against non-existent `@/lib/migration/collapseRun` — confirmed `Cannot find module`. | Implemented; all 4 passed on first run. | N/A |

All five pure modules were written test-first, confirmed failing on `MODULE_NOT_FOUND` before any implementation existed, matching the same evidence pattern as batch 1. `queries.ts`, `scripts/unify-contacts.ts`, and the admin page/action are DB- or Next.js-request-bound and are not unit-tested, consistent with `requireAdmin()`'s precedent and design.md's testing strategy (DB-backed coverage deferred to dry-run-on-snapshot / E2E, neither run in this batch per the hard safety rule).

## Test Results

```
$ npm run test:unit
ℹ tests 81
ℹ pass 81
ℹ fail 0

$ npm run typecheck
(no output — clean)
```

## Deviations from Design

- **Task 3.4, `snapshotBackup()`**: design.md's migration plan says "--execute ... A production backup is taken first," but does not specify a mechanism (Supabase point-in-time recovery? `pg_dump`? something else?), and I have no visibility into this project's actual backup/infra setup. Rather than guess and risk a false sense of safety, `scripts/unify-contacts.ts#snapshotBackup()` is an explicit stub that **always throws** — `--execute` cannot proceed until the owner decides on and wires a real mechanism. This is a deliberate fail-safe, not a missed task. Everything else in 3.4 (the approval/hash gate, `migration_run_id` tagging) is implemented and unit-tested.
- **Report shape**: contact-migration spec asks for "auto-merged / flagged-for-review / new counts ... per affected table." Since Phase 3 only processes `contact` (Phase 4 adds `lead`), the report is shaped as `{ contact: {...}, persons: {...}, connections: {...} }` rather than a flat count set, so Phase 4 can add a sibling `lead` block without a breaking change. Not explicitly specified in design.md; a reasonable extrapolation, flagged here rather than silently assumed.
- **Email-field merging**: `mergeProperties` (from the matcher, R7) merges each named property independently. For collapse, `email`/`emailStatus`/`emailConfidence`/`emailSource` are correlated and must move together as one unit (picking `email` from one row and `emailStatus` from another would desync them) — `collapsePlanner.ts#mergeEmailFields` handles this as a dedicated unit keyed on `emailStatusRank`, rather than calling the generic per-field `mergeProperty` for each of the four fields separately. Not a change to the matcher itself, just how the planner composes it.
- **`person_id_map.method` per legacy row**: design.md's data model lists the method vocabulary (`profile_key`/`verified_email`/`review`/`new`/`skipped_own_company`) but doesn't spell out which method applies to which row in a multi-row collapse group. I record the *actual* match outcome for each individual legacy row (first row of a group → `new` or `review`; later rows → whichever matcher key it matched — `profile_key` or `verified_email`), not a single method for the whole group.

## Issues Found

None beyond the pre-existing PR 1/PR 2 flags already recorded above (migration 0012 ledger, PR budget overages) — both still awaiting your decision, not re-litigated here.

## Review Workload / PR Boundary — flagged, not silently absorbed

**PR 3 forecast in design.md: ~380 lines. Actual, `git diff --stat feat/crm-hubspot-ux-02-matcher...feat/crm-hubspot-ux-03-collapse`: 16 files, 1,499 insertions, 0 deletions.**

Per your standing rule ("the 400-line budget counts production CODE only; tests/docs overage is fine — report the split"):

| Category | Lines | Files |
|---|---|---|
| Production code | **1,099** | 11 |
| Tests | 400 | 5 |
| Docs | 0 | — |

Production code alone is **~2.7x the 400-line budget.** I did not stop mid-implementation (the work was already committed once I could measure it precisely), but I did NOT push either branch or open a PR, per your instruction — flagging here for your decision before any PR is opened, same as PR 1/PR 2.

**Breakdown by commit** (these 3 commits are already on `feat/crm-hubspot-ux-03-collapse` in this order, and are a natural chained-PR split if you want one):

| Commit | Content | Code lines | Test lines | Total | 400-line risk (code only) |
|---|---|---|---|---|---|
| `feat(migration): add pure collapse-phase migration planner` | `collapsePlanner.ts`, `collapseRun.ts`, `connectedOn.ts`, `executionGuard.ts`, `inputHash.ts` + their 5 test files | 526 | 400 | 926 | **Over** — 526 vs 400 (+126, ~31%) |
| `feat(migration): wire the collapse planner to the database and CLI` | `queries.ts`, `scripts/unify-contacts.ts` | 321 | 0 | 321 | Under budget |
| `feat(admin): add /admin/migration dry-run review page` | `page.tsx`, `actions.ts`, `en.ts`/`es.ts` dictionary additions | 252 | 0 | 252 | Under budget |

Only the first commit exceeds the code budget, and only by ~31% — driven by `collapsePlanner.ts` itself (341 lines), which is one cohesive pure algorithm (matching loop + property-merge composition + owner selection + report totals) with the same heavy-doc-comment convention flagged as a driver in PR 1. I did not find a clean sub-split: pulling the merge logic or report-building into a separate file would fragment one algorithm across files without reducing total lines. The closest mechanical split — moving `connectedOn.ts` + `executionGuard.ts` + `inputHash.ts` (115 code lines, 146 test lines) into their own commit/PR ahead of `collapsePlanner.ts` + `collapseRun.ts` (411 code lines, 254 test lines) — still leaves the planner slice 11 lines over budget, which is close enough to trivial that I'd call it `size:exception` territory either way.

**Recommendation to the orchestrator**: either (a) accept the 3 commits as-is as one PR under `size:exception` (total 1,099 code lines, but no single commit except the first is far over, and that one is a self-contained, heavily-tested pure-logic module), or (b) split into 3 chained PRs along the existing commit boundaries — PR 3a (planner, needs `size:exception` for +126 lines), PR 3b (DB wiring, in budget), PR 3c (admin page, in budget). I have not pushed anything or opened any PR; both branches/commits are local only, awaiting your decision, consistent with how PR 1/PR 2 were left for your review last batch.

---

# Batch 3 — Owner decisions + fresh review fixes for PR 3

The orchestrator relayed the owner's decision: PR 3 is now **three chained branches**, cut exactly at batch 2's commit boundaries and already split by the orchestrator before this batch started:

- `feat/crm-hubspot-ux-03a-planner` (base: `feat/crm-hubspot-ux-02-matcher`) — `size:exception` **approved** for its ~526 code lines.
- `feat/crm-hubspot-ux-03b-cli` (base: 03a).
- `feat/crm-hubspot-ux-03c-admin-page` (base: 03b).

`feat/crm-hubspot-ux-03-collapse` is now obsolete and has been **deleted locally**.

A fresh-context review found 4 issues, fixed in this batch (strict TDD — RED confirmed before every fix), then each chained branch was rebased (`git rebase --onto`) onto the previous branch's new head. No conflicts during any of the three rebases.

## Fixes

1. **CRITICAL (03a)** — `collapsePlanner.ts`'s index registration unconditionally overwrote `byProfileKey`/`byVerifiedEmail` entries. A `conflicting_strong_keys` review row (profile key → person A, verified email → person B) repointed BOTH A's profile key and B's email to the brand-new review person C, so a later row carrying only one of those keys wrongly merged into C instead of the person that actually owned it. Fixed with set-if-absent index writes (`registerRowKeys`, renamed from `registerPerson`), which now also runs on auto-merges so a row that matches via one strong key but carries a second, not-yet-indexed one gets that second key registered too (always safe — `matchIdentity` only returns `auto` when the unindexed key was genuinely unclaimed). 2 new regression tests.
2. **03a** — `inputHash.ts` hand-picked 10 of `CollapseContactRow`'s 15 fields, silently excluding `companyKey`/`companyCategory`/`roleGroup`/`industry`/`emailConfidence`/`emailSource` from the `--execute` staleness check. Replaced the hand-picked list with a reflective canonical serializer (`Object.keys(row)`, sorted) so there's no second list to drift out of sync. Regression test mutates all 15 non-id fields one at a time and asserts the hash changes for each.
3. **03b** — Execution bookkeeping: `runCollapseExecute` created a brand-new `migration_run` row on every `--execute`, orphaning the approved dry-run row (`executedAt` stayed null forever) and letting a second `--execute` silently insert yet another row instead of being refused. Fixed: `executionGuard` now checks `executedAt` before the hash comparison (new `already_executed` reason); `collapseRun.runCollapseExecute` takes the full approved run and calls one `finalizeExecute` port that writes the plan, sets `mode='execute'` + `executedAt` on the SAME row, and writes one `audit_log(migration_execute)` entry — all in one transaction. Also refuses up front if the approved run has no `approvedByBdId` (audit_log's actor column is not-null). A follow-up fix in the same branch also flips `mode` to `'execute'` on finalize (missed in the first pass — the history table would otherwise show "Simulación" forever for an executed run).
4. **03b** — Implemented the owner-approved `snapshotBackup()`: `pg_dump` (custom format, `-Fc`) of every table the migration touches (legacy `contact`/`lead` universe, messaging, `bd`, and every 0013 table) to `backups/<runId>-<ISO timestamp>.dump`, then verifies with `pg_restore --list` plus a minimum-size floor; either failing aborts before any write. Binary resolution: `PG_DUMP_PATH` env, else `pg_dump` on PATH, else the homebrew libpq fallback path; `pg_restore` is derived from whichever `pg_dump` path actually worked (same bin directory) rather than a second independent env var. `backups/` added to `.gitignore`. Only the pure parts (binary resolution, file naming, argument building, the verification decision) are unit-tested — the real process spawn is not, per the review's explicit instruction.
5. **03c (self-found while integrating)** — Once 03b's execution bookkeeping was fixed, the admin page's existing "not executed" warning and history-table status column were already correct for free (they read `executedAt` off the right row now). Added two lines that were still missing once a run IS executed: "Ejecutada el `<date>`" and the backup file path (duck-typed off `report.backupPath`, which `finalizeExecute` folds into the existing jsonb `report` column rather than a new schema column — a deliberate choice to avoid a schema migration for one field; flagged here in case the owner would prefer a dedicated `migration_run.backup_path` column instead).

## Branches / Commits (final heads)

| Branch | Base | Commits | Final head |
|---|---|---|---|
| `feat/crm-hubspot-ux-03a-planner` | `feat/crm-hubspot-ux-02-matcher` | `d610770` (original) → `cef98e3` (fix 1) → `eabb3d0` (fix 2) | `eabb3d0` |
| `feat/crm-hubspot-ux-03b-cli` | `feat/crm-hubspot-ux-03a-planner` | `173bf99` (original, rebased) → `6117063` (fix 3) → `6b0304f` (fix 4) → `a9ffd9b` (mode-flip follow-up) | `a9ffd9b` |
| `feat/crm-hubspot-ux-03c-admin-page` | `feat/crm-hubspot-ux-03b-cli` | `69094a5` (original, rebased) → `434f6fc` (fix 5) | `434f6fc` |

No conflicts during either rebase (`03b` onto `03a`'s new head, then `03c` onto `03b`'s new head, redone once more after the mode-flip follow-up commit landed on `03b`). Nothing pushed; no PRs opened, per instruction.

## Test / Typecheck Results (verified independently per branch, after all rebases)

| Branch | `npm run test:unit` | `npm run typecheck` |
|---|---|---|
| `feat/crm-hubspot-ux-03a-planner` | 84/84 pass | clean |
| `feat/crm-hubspot-ux-03b-cli` | 101/101 pass | clean |
| `feat/crm-hubspot-ux-03c-admin-page` | 101/101 pass | clean |

## Line Split Per Branch vs. Its Own Base

| Branch | Base | Code | Tests | Config | Total (add+del) |
|---|---|---|---|---|---|
| 03a | 02-matcher | 555 (+555/-0) | 548 (+548/-0) | — | 1,103 |
| 03b | 03a | 645 (+612/-33) | 264 (+229/-35) | 5 (`.gitignore`) | 914 |
| 03c | 03b | 274 (+274/-0) | 0 | — | 274 |

**03a**: code grew from ~526 to 555 (the two fixes' net code additions) — still the `size:exception` the owner already approved covers this; flagging the updated number for the record, not asking again.

**03b**: code is 645 lines vs. the 400 budget — **new overage, not previously flagged**, driven by the real `pg_dump`/`pg_restore` backup implementation (`backup.ts`, 197 lines) plus the execution-bookkeeping rewrite (`queries.ts` 254 lines — this file did not exist on 03a's side of the diff, so it counts in full; `collapseRun.ts`/`executionGuard.ts` modifications; the CLI script). I did not attempt to further split 03b in this batch — the instruction was to fix the review's findings and restack, not re-litigate the workload guard — but flagging it now for the same decision as 03a: `size:exception`, or a further split (e.g. "bookkeeping" vs. "backup" as separate PRs along the two commits already on this branch).

**03c**: 274 lines, within budget, no action needed.

## Deviations / Owner-Visible Decisions

- `backupPath` is stored inside the existing jsonb `migration_run.report` column (merged in at finalize time) rather than a new dedicated column, to avoid an additional schema migration for one field. `audit_log.metadata` also carries it. If the owner prefers a first-class `backup_path` column, that's a follow-up migration, not a rewrite.
- `pg_restore`'s path is derived from whichever `pg_dump` path resolution actually succeeded (same directory, `pg_dump` → `pg_restore`) rather than a second independent `PG_RESTORE_PATH` env var, since the review only specified resolution for `pg_dump`. Documented in `backup.ts`'s comments.
- Still not run, not even once: no migration, script, or dry run has touched any database in any batch of this change. Every guarantee above is proven by unit tests against fixtures/fakes, plus `npm run typecheck`.

## Remaining Tasks (next batch)

- [ ] Phase 3 (PR 3): task 3.5 (owner GATE — reviewing the actual collapse dry-run report against production data via Vercel preview) — requires the branches to be pushed/merged and a real dry run executed first. Not attempted here per the hard safety rule.
- [ ] Phase 4 (PR 4): Fold leads.
- [ ] Phase 5 (PR 5): Status derivation & re-scope reads.
- [ ] Phase 6 (PR 6): Merge/unmerge engine.
- [ ] Phase 7 (PR 7): Duplicate review UI.
- [ ] Phase 8-14: UI shell, record pages, list pages (see tasks.md).

## Status

**Cumulative across batches 1-3**: Phase 0 (2/2), Phase 1 (4/4), Phase 2 (4/4), Phase 3 (5/6 — 3.1 through 3.4 and 3.6 done; 3.5 is an owner-only GATE against production data). 15/16 checkboxes through Phase 3.

Nothing has been pushed and no PR has been opened for PR 1, PR 2, or PR 3 (now 3a/3b/3c) — all work is local commits on `feat/crm-hubspot-ux-01-schema`, `feat/crm-hubspot-ux-02-matcher`, `feat/crm-hubspot-ux-03a-planner`, `feat/crm-hubspot-ux-03b-cli`, and `feat/crm-hubspot-ux-03c-admin-page` (all ultimately based off `feat/crm-hubspot-ux`), awaiting review/push.

**Blocked on your decisions, in order**:
1. PR 1's `size:exception` (781 lines, schema/migration) and PR 2's `size:exception` (509 lines, identity matcher) — carried over from batch 1, unresolved.
2. PR 3a's `size:exception` is already approved (555 lines, updated from the pre-fix 526) — no new decision needed, noted for the record.
3. PR 3b's budget: 645 code lines vs. 400 — new overage from this batch's fixes (mainly the real backup implementation). Needs the same `size:exception`-or-split decision.
4. Task 3.5's GATE — reviewing the actual collapse dry-run report against production data once these branches are pushed/merged and a real dry run is executed. Not attempted in this batch per the hard safety rule (no DB access at all, not even dry-run).

Ready for `sdd-apply` to continue with Phase 4 once PR 3a/3b/3c are resolved, or for a fresh-context review of the three branches first.
