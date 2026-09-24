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

## Remaining Tasks (next batch)

- [ ] Phase 3 (PR 3): Collapse migration + dry-run gate — `scripts/unify-contacts.ts --phase=collapse --dry-run`, `/admin/migration` page, execute gate.
- [ ] Phase 4 (PR 4): Fold leads.
- [ ] Phase 5 (PR 5): Status derivation & re-scope reads.
- [ ] Phase 6 (PR 6): Merge/unmerge engine.
- [ ] Phase 7 (PR 7): Duplicate review UI.
- [ ] Phase 8-14: UI shell, record pages, list pages (see tasks.md).

## Status

6/6 tasks in this batch's scope complete (Phase 0: 2/2 preconditions confirmed already satisfied, Phase 1: 4/4, Phase 2: 4/4 — 10/10 counting every checkbox). Not yet pushed; not yet PR'd. **Blocked on your decision**: accept PR 1's `size:exception`, or ask me to attempt a further split, before I push either branch or open PRs. Ready for `sdd-apply` to continue with Phase 3 once PR 1/2 are resolved, or for a fresh-context review of the two branches first.
