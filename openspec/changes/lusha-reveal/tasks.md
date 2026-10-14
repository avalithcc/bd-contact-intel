# Tasks: Lusha Contact Reveal

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,540 lines of CODE across 6 PRs, plus ~1,500 lines of tests/fixtures and ~80 lines of docs/mockups (tests and docs do not count against the budget) |
| 400-line budget risk | High as a single PR (3.9x); every individual PR is forecast at or under 400 lines of code |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 6 (see tables below) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No for PRs 1-5 (no PR needs a `size:exception`; strategy already resolved). PR 6 is blocked by gate 0.3 (approved mockup), not by a decision.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Stacked-to-main**: every PR merges to `main` in order; the next PR branches off the updated `main`. No tracker branch, no PR targets another PR's branch. Consequence that drives the whole plan: **every merge to `main` deploys to production**, so every PR except the last must be inert.

**Budget rule**: 400 lines of CODE per PR. Tests, fixtures, mockups and docs do not count (owner rule); test/doc overage proceeds, code overage needs owner approval. Migration SQL and `schema.ts` count as code (conservative).

### The safety rule, and how the plan enforces it

**Nothing a user can reach exists until PR 6.** No component imports a Lusha server action, no route handler mentions Lusha, no `page.tsx` reads the ledger, and no code path under `src/app` imports `@/lib/lusha/*` except the actions file itself. PRs 1-4 export functions nothing imports. PR 5's server actions are only reachable once a client component imports them (PR 6); until then Next.js never emits their action ids into any bundle. Removing `LUSHA_API_KEY` is the kill switch for all six regardless (D13).

**Mechanical enforcement (task 1.1)**: PR 1 adds `tests/unit/lushaInert.test.ts`, which fails CI if any file under `src/app` other than `contacts/lushaActions.ts` imports `@/lib/lusha/*` or `lushaActions`, if any `route.ts` or `page.tsx` path contains `lusha`, or if any `"use client"` file references `lushaActions`. PR 6 inverts it into the positive assertions (task 6.9). This is the mirror of `tests/unit/sequencesInert.test.ts` in `outreach-sequences`.

### Suggested Work Units

| PR | Title | Slice | Base | Est. code lines | Fits 400? | Gate |
|---|---|---|---|---|---|---|
| 1 | Pure policy: inertness guard, `config`, `errors`, `pricing`, `cap` | A | `main` | ~190 | Yes (48%) | TDD |
| 2 | Client and parsers: `client`, `parse`, `revealState`, fixtures | A | `main` | ~290 | Yes (73%) | TDD; `reveal` required param |
| 3 | Data model: migration `0044`, rollback, `schema.ts`, comment vocabularies | B | `main` | ~120 | Yes (30%) | **0.1 apply migration to prod BEFORE merge**; **0.2 re-check number** |
| 4 | Ledger and write path: `revealPlan`, `revealDb`, duplicate-candidate write | B | `main` | ~350 | Yes (88%) | TDD; integration script |
| 5 | Actions and registration: `lushaActions`, `actionErrors`, copy, activity type, README | B | `main` | ~230 | Yes (58%) | TDD; **touches live activity registries** |
| 6 | **UI**: wiring, reveal control, three dialogs, badges, guard inversion | C | `main` | ~360 | Yes (90%) | **0.3 mockup approved**; 0.4-0.6 |

No PR requires a `size:exception`. PR 4 (88%) and PR 6 (90%) are the ones at risk; pre-agreed fallbacks are in the Review Workload Detail.

### PR Chain

Order is the merge order. Branch names follow `type/description` (`^(feat|fix|chore|docs|...)\/[a-z0-9._-]+$`).

| # | Branch | Contains | Depends on | Reachable by a user after merge |
|---|---|---|---|---|
| 1 | `feat/lusha-reveal-01-pure-policy` | inertness guard test, `config.ts`, `errors.ts`, `pricing.ts`, `cap.ts` | none | Nothing |
| 2 | `feat/lusha-reveal-02-client-parsers` | `client.ts`, `parse.ts`, `revealState.ts`, `tests/unit/fixtures/lusha/` | 1 (merge order; `errors.ts` types) | Nothing |
| 3 | `feat/lusha-reveal-03-data-model` | `0044` + rollback, `lusha_reveal` in `schema.ts`, two schema comments | 1, 2 (merge order only) | Nothing |
| 4 | `feat/lusha-reveal-04-ledger-write-path` | `revealPlan.ts`, `revealDb.ts`, duplicate-candidate write, integration script | 1, 2, 3 | Nothing |
| 5 | `feat/lusha-reveal-05-actions-registration` | `lushaActions.ts`, `actionErrors.ts` table, `actionFailure` move, `es`/`en` copy, activity registration, README | 1-4 | Nothing (actions imported by no component) |
| 6 | `feat/lusha-reveal-06-ui` | `page.tsx` wiring, control, dialogs, badges, inversion of the guard | 1-5 and gate 0.3 | **The feature** (still off until the production key is set, gate 0.6) |

Dependency constraints honored: data model (3) precedes the ledger (4); pure policy and parsers (1-2) precede the orchestration that calls them (5); the mockup (track M) precedes the UI (6). PRs 1-2 have no DB dependency and PR 3 has no code dependency on 1-2, but they merge in numeric order.

### Per-PR reachability statement

"Reachable" = a user or the internet can trigger it. "Inert" = exists in the deployed bundle but nothing can invoke it.

| PR | Becomes reachable | Stays inert |
|---|---|---|
| 1 | Nothing. | Four pure modules and the guard test, imported only by tests. |
| 2 | Nothing. The client takes `fetch` and the key as arguments; no test and no caller can reach the network. | Client, parsers, state resolver. |
| 3 | Nothing. A new empty table with RLS on and no policies; no existing query selects from it. Migration is applied to production by hand first (0.1). | The table. |
| 4 | Nothing. `revealDb` and `revealPlan` are imported only by tests and (in PR 5) by the actions file. | Ledger writes, planners, duplicate enqueue. |
| 5 | Nothing visible. Server actions are imported by no component, so Next.js emits no action ids. **One live-code touch**: `lusha_reveal` is added to activity registries; no activity of that type can exist yet, so existing behavior is unchanged. `actionFailure` moves files with no behavior change. | `lushaActions`, error table, copy. |
| 6 | **The feature**: the control on the email and phone rows, three dialogs, badges. Still renders nothing unless `VERCEL_ENV === 'production'` and `LUSHA_API_KEY` is set (D13). | Nothing; gated by Phase 0, not by code. |

## Phase 0: Gates and open blockers (NOT tasks to solve; checklist items that block merges)

- [ ] 0.1 **GATE (ordering, blocks PR 3 and therefore PR 4+)**: apply `0044_lusha_reveal` to production BEFORE merging the PR that declares `lusha_reveal` in `schema.ts`. Drizzle selects every declared column, so declaring a table or column the database lacks breaks live queries; this is the same gate `outreach-sequences` carries as its 0.1. Order: `drizzle-kit generate`, review SQL, `migrate` against production, verify (`relrowsecurity` true), then merge. `db:push` is never used (it leaves RLS off). Strictly, a brand-new table is not selected by any existing query, so PR 3 would not break reads; the gate stays mandatory because PR 4 is the first code that queries the table and the order must never be reversed.
- [ ] 0.2 **GATE (blocks PR 3 merge)**: re-check the migration number against `drizzle/` at implementation time. Today `0041` and `0042` are on disk and `0043` is reserved by `outreach-sequences` PR 10 (`email_message.is_automatic`, planned, not merged), so this change takes `0044`. If that chain slips and `0043` is still free when PR 3 is built, this migration takes `0043` and the sequences one moves up. Renumbering is a file rename plus its `_rollback.sql` twin; two files with the same prefix are never applied.
- [ ] 0.3 **GATE (blocks PR 6 start, not just merge)**: the owner approves an HTML mockup before any UI code is written (standing rule: mockups before UI code). Task M.1 produces it; PR 6 cannot be branched until the owner approves.
- [ ] 0.4 **GATE (decision, blocks PR 6 merge)**: who clears the duplicate queue. `/admin/duplicates` is `requireAdmin()`-gated (`src/app/(app)/admin/duplicates/page.tsx:178`), so a BD cannot reach the merge flow. A revealed email that collides enqueues a `duplicate_candidate` (`reason='lusha_reveal_email'`) for the owner, who is the admin. The owner confirms he will work that queue; otherwise the on-screen warning is the only thing the BD gets (D12).
- [ ] 0.5 **GATE (decision, blocks PR 6 merge)**: the owner accepts that no pre-production visual review of the live control exists. The production gate (D13) renders nothing on preview deploys and local dev, so the real control is only ever seen in production. Mitigations in this plan: the approved mockup, view-model unit tests per state (6.7) and fixture-driven component rendering. Named limitation: "Local review never exercises the integration".
- [ ] 0.6 **GATE (go-live, after PR 6 merges)**: set `LUSHA_API_KEY` (and optionally `LUSHA_DAILY_CREDIT_CAP`, default 12) in the Vercel **production** environment only, then redeploy (env changes need one). Do not set the key in Preview or Development. Setting the key is the on-switch and removing it is the kill switch; it is a deliberate owner action, not a task. Remaining pool at planning time: 38 of 40 credits.
- [ ] 0.7 **MEASUREMENT (post go-live, D17)**: the first production phone reveal is the measurement of the `phones[]` shape. The raw payload is persisted on the ledger row. Watch the first one; if `pickPhone` returns `unparsable_value` or the column rule (D11) is wrong, open a follow-up parser PR from the stored payload. The owner declined to spend 5 credits on a probe. Not a task of this change; the correction is a separate PR with no second reveal needed.

## Phase 1: Pure Policy (PR 1, base: main)

Reachable: nothing. Inert: four pure modules and a guard test, imported only by tests.

- [x] 1.1 RED/GREEN: `tests/unit/lushaInert.test.ts` asserts, by reading the repo tree: no file under `src/app` other than `src/app/(app)/contacts/lushaActions.ts` imports from `@/lib/lusha`; no file under `src/app` imports `lushaActions`; no `route.ts` or `page.tsx` path contains `lusha`; no `"use client"` file references `lushaActions`; `vercel.json` contains no `lusha`. Passes trivially today and fails the moment a later PR makes something reachable early. Inverted in 6.9.
- [x] 1.2 RED/GREEN: `src/lib/lusha/config.ts` `getLushaConfig()` returning `{ ok: true, config }` | `{ ok: false, reason: 'not_production' }` | `{ ok: false, reason: 'missing_env', missing: string[] }` (D13). Required cases: `VERCEL_ENV=production` + key -> ok; `VERCEL_ENV=preview` with `NODE_ENV=production` and a key -> `not_production` (the preview-deploy trap); local dev -> `not_production`; production without key -> `missing_env` naming `LUSHA_API_KEY`; empty or whitespace key counts as missing; never throws; the reported value is the variable **name**, never the key. (spec `lusha-production-gate`)
- [x] 1.3 RED/GREEN: `src/lib/lusha/errors.ts` `LushaError { kind }` with every kind from the taxonomy: `bad_key`, `no_credits`, `plan_denied`, `rate_limited`, `compliance_blocked`, `unavailable`, `not_found`, `compliance_restricted`, `enrich_failed`, `async_unsupported`, **`unparsable_value`**, `cap_exceeded`, `busy`. Pure functions: `kindFromHttpStatus` (401/402/403/429/451/5xx), `kindFromContactCode`, `isPermanent(kind)` (true only for `compliance_blocked` and `compliance_restricted`, D6), `isRetryableByBd(kind)`. Exhaustive-table test so adding a kind without a decision fails. No retry flag or backoff field exists on the type (spec `lusha-error-handling`: nothing is retried automatically). The `ContactActionErrorReason` mapping is PR 5, not here.
- [x] 1.4 RED/GREEN: `src/lib/lusha/pricing.ts` `expectedCost(field, canReveal)` reads the API's own price list; a reveal with no cached `canReveal` is refused with a typed result, never guessed; no hardcoded price table anywhere (test: grep the module for numeric price literals other than the search's declared `1`).
- [x] 1.5 RED/GREEN: `src/lib/lusha/cap.ts` `parseDailyCreditCap(raw)` and `evaluateCap({ spentToday, cap, expected })`. `parseDailyCreditCap` on `""`, `"abc"`, `"-1"`, `"NaN"`, `"Infinity"` -> default 12; `"0"` -> 0 (soft kill switch); `"50"` -> 50; a NaN never becomes `Infinity`. `evaluateCap`: exactly-at-cap allowed, one over refused, a 5-credit phone refused with 8 remaining after 4 spent of 12 (`7 + 5 > 12`), returns `remaining` for the dialog. (spec `lusha-credit-cap`)

Commits:
- `test(lusha): guard that no Lusha import, route or page is reachable yet`
- `feat(lusha): add production gate and typed error taxonomy`
- `feat(lusha): add expected-cost pricing and daily credit cap policy`

## Phase 2: Client and Parsers (PR 2, base: main)

Reachable: nothing. `client.ts` takes the key and `fetch` as arguments and never reads `process.env`; no test calls the Lusha API.

- [ ] 2.1 Fixtures: commit the live probe's real responses (engram `#560`), emails and phones redacted, under `tests/unit/fixtures/lusha/`: search matched (with `canReveal`), search `NOT_FOUND`, enrich with emails, enrich with `WATERFALL_NOT_IN_PLAN` and `status: "partial"`, 451, `COMPLIANCE_RESTRICTED`, `ENRICH_FAILED`, async `job`. The phone shape was never measured: add a **synthetic** phone fixture clearly labelled unverified, plus a deliberately wrong shape for 2.3.
- [ ] 2.2 RED/GREEN: `parse.ts` `matchByClientReferenceId` returns the right result against a **reordered** results array (never by index); `parseSearchResponse` yields `matched` / `no_match` plus identity (name, company, domain, social links) and the `canReveal` price list; `parseEnrichResponse` treats `WATERFALL_NOT_IN_PLAN` / `partial` as success, not an error; an async `job` body -> `async_unsupported`.
- [ ] 2.3 RED/GREEN: `pickEmail` / `pickPhone` are deterministic (work type first, then highest confidence, then first; never blindly element zero), return nothing for an empty array, and **`pickPhone` fails closed**: a deliberately wrong shape yields `unparsable_value`, not a best-effort string (D17). The full raw arrays are returned alongside so PR 4 can persist them.
- [ ] 2.4 RED/GREEN: `client.ts` `searchContact` and **`enrichContact(key, fetch, ids, reveal)` where `reveal` is a required positional parameter** (D14). Tests: compile-time proof that omitting it is a type error (`@ts-expect-error`); search body uses `clientReferenceId = personId`; header is `api_key`; `AbortSignal.timeout(15s)`; the key never appears in a thrown error, message or log line; a fake `fetch` is called **exactly once** on 401/402/403/429/451/5xx/timeout (no retry); transport errors map to `unavailable`; the free account-usage call exists and its failure is non-blocking.
- [ ] 2.5 RED/GREEN, **its own test**: `reveal: ["emails"]` is always sent explicitly for an email reveal and `["phones"]` for a phone reveal, never both and never omitted, asserted on the serialized request body. Omitting it returns both fields and spends 5 extra credits (spec `lusha-reveal-action`, "A request names exactly one field").
- [ ] 2.6 RED/GREEN: `revealState.ts` `resolveRevealState(latestRows, cap, config)` pure over all nine states: `off`, `unconfigured`, `searchable`, `revealable(price)`, `unavailable`, `rejected`, `blocked`, `revealed(value)`, `capped`. Required cases: a settled `matched` search is reused for both fields (phone after email does not re-search); `match_rejected` offers "buscar de nuevo" and not an auto re-offer; `no_match` is retryable manually; `compliance_restricted` offers nothing; `canReveal` without `emails` -> no spend offered; a `failed` row does not block a retry; `revealed` serves the stored value with no network (the hybrid cache: first attempt pays search + reveal, the search outcome is never paid again except through the explicit manual re-search).
- [ ] 2.7 Test: `client.ts` contains no reference to `process.env`; no unit test imports a real `fetch` binding.

Commits:
- `test(lusha): add redacted probe fixtures and response parsers`
- `feat(lusha): add injected-fetch client with required reveal parameter`
- `feat(lusha): add reveal-state resolver over the latest ledger rows`

## Phase 3: Data Model (PR 3, base: main)

Reachable: nothing. Inert: an empty table with RLS on and no policies.

**Merge precondition: gates 0.1 and 0.2.**

- [ ] 3.1 Re-check `drizzle/` for the next free number (gate 0.2). Write `drizzle/0044_lusha_reveal.sql`: `lusha_reveal` with the D1 columns (`id`, `person_id` -> `person(id)` cascade, `field`, `state` default `'reserved'`, `outcome`, `value`, `value_normalized`, `credits_reserved` not null, `credits_charged`, `lusha_contact_id`, `payload` jsonb not null default `'{}'`, `actor_bd_id` -> `bd(id)` set null, `rejected_by_bd_id`, `rejected_at`, `error_code`, `at` default now(), `settled_at`). Free text for `field`/`state`/`outcome`, no CHECK (repo convention).
- [ ] 3.2 Indexes in the same migration: `unique (person_id, field) WHERE state = 'reserved'` (the double-click guard and nothing else, D4); `(person_id, field, at desc)`; `(at)`. **Not** `(actor_bd_id, at)` (no spend dashboard in this slice).
- [ ] 3.3 RLS inside the migration: `ALTER TABLE lusha_reveal ENABLE ROW LEVEL SECURITY` with **no policies** (posture of `0019` and `0040`).
- [ ] 3.4 Write the `_rollback.sql` twin (convention since `0028`).
- [ ] 3.5 Mirror the table in `src/db/schema.ts`; run `drizzle-kit generate` and confirm no further diff against the hand-written SQL. Extend the `person_property_history.source` vocabulary comment with `lusha_reveal` and the `activity.type` comment with `lusha_reveal` (comment-only edits, no schema change).
- [ ] 3.6 Verification (local DB, then production per 0.1): `relrowsecurity` true; the partial unique index rejects a second `reserved` row for the same (person, field) and allows it once the first is `settled`; rollback restores the prior shape; `npm run typecheck` and `npm run test:unit` green.

Commits:
- `feat(lusha): add lusha_reveal ledger table with RLS enabled`

## Phase 4: Ledger and Write Path (PR 4, base: main)

Reachable: nothing. `revealDb` and `revealPlan` are imported only by tests until PR 5. `revealDb.ts` does not import `client.ts`: the HTTP call is the caller's job, structurally outside the lock (asserted in 4.3).

- [ ] 4.1 RED/GREEN: `revealPlan.ts` `planRevealedEmailWrite()` produces `{ personUpdate, historyRows, activity }` in the exact shape `planPropertyEdit` produces: `email`, `emailNormalized`, **`emailStatus='probable'`**, **`emailSource='lusha'`**, `emailConfidence`; history rows with `source='lusha_reveal'`. Eligibility is `!isReachable(person)` imported from `src/lib/sequences/rosterGuards.ts`: empty, `none` and `pattern_inferred` are overwritten; a verified or already-probable email is **never** overwritten. Assert the written result through the **real** `isReachable` (so the revealed Contact becomes Sequence-eligible), not a restated rule. Test that the module does not import `updateContactProperty` or `planPropertyEdit`. (spec `lusha-reveal-write`)
- [ ] 4.2 RED/GREEN: `planRevealedPhoneWrite()` per D11: `mobile` -> `mobilePhone`, anything else -> `phone`; the occupied target falls back to the other column when empty; **both occupied -> nothing is overwritten**, the value stays on the ledger and is returned for the dialog; `unparsable_value` -> no person write at all but the ledger still settles with the real `credits_charged` (D17).
- [ ] 4.3 RED/GREEN: `revealDb.reserve()` in ONE short transaction: `pg_advisory_xact_lock(LUSHA_CAP_LOCK)`, then the day's `sum(coalesce(credits_charged, credits_reserved))` over the AR business day (`argentinaDayBoundaries` from `src/lib/tasks/argentinaDate.ts`, not UTC and not Lusha's `resetsAt`), `evaluateCap`, re-read of the latest search row (it may have been rejected meanwhile), then `INSERT ... ON CONFLICT DO NOTHING RETURNING` with `target: [personId, field], targetWhere: state = 'reserved'`. No row returned -> `busy`. Cap from the **ledger only**: a test asserts `/v3/account/usage` is never consulted for enforcement. Source test: `revealDb.ts` imports nothing from `client.ts`.
- [ ] 4.4 RED/GREEN: `settleSearch()` (outcome `matched` | `no_match`, `credits_charged` from billing, `payload` with identity and `canReveal`), `failReservation()` (`state='failed'`, `error_code`, `credits_charged` stays null so the **reserved amount keeps counting** against the day, D8), `rejectMatch()` (updates the latest search row to `match_rejected` with `rejected_by_bd_id` / `rejected_at`, charges nothing, **never touches `credits_charged`**, D5).
- [ ] 4.5 RED/GREEN: `settleReveal()` in ONE `db.transaction`: ledger update (`revealed` | `no_value` | `compliance_restricted`, `credits_charged`, `value`, `value_normalized`, full `emails[]` / `phones[]` in `payload`), `person` update from the planner, history rows, the `lusha_reveal` activity inserted **directly** (not via `createActivityInTx`, D15), with `actorBdId` and `metadata { field, creditsCharged, lushaId }`. No activity when nothing was revealed. A settle that rolls back leaves no `person` write.
- [ ] 4.6 RED/GREEN: duplicate-email write inside the settle transaction (D12): when the normalized email is live on another non-merged Contact, write the value **and** insert `duplicate_candidate` (`reason='lusha_reveal_email'`, `matchKey` = normalized email, pair ordered by id, `onConflictDoNothing`), and return the other Contact's id and name. A merged-away holder is ignored; no duplicate -> no row and no warning payload. No unique index on `person.email`.
- [ ] 4.7 Reads: `getDailySpend()` and `getRevealState(personId)` (`DISTINCT ON (field)` latest row per field, at most three rows, one scan on the `(person_id, field, at desc)` index).
- [ ] 4.8 Integration script (seeded local DB, not the unit suite): two concurrent `reserve()` on the same (person, field) -> exactly one row; two concurrent reveals that together exceed the cap -> exactly one proceeds; a `failed` row does not block a later reserve; the settle transaction rolling back leaves no `person` write; a double click is `busy`, not a second charge.

Commits:
- `feat(lusha): add revealed-email and revealed-phone write planners`
- `feat(lusha): add advisory-locked credit reservation and ledger settle with duplicate enqueue`

## Phase 5: Actions and Registration (PR 5, base: main; touches live activity registries)

Reachable: nothing visible. Actions are imported by no component. The activity-type registration edits live lists but no `lusha_reveal` activity can exist yet.

- [ ] 5.1 RED/GREEN, **activity registration (D15)**: add `lusha_reveal` to `STATUS_NEUTRAL_ACTIVITY_TYPES` and `NO_PROGRESS_ACTIVITY_TYPES` **only**, plus `TIMELINE_ACTIVITY_TYPES` and the `system` pill group. Tests: membership in exactly those two semantic lists; **absence from `NON_TOUCH_ACTIVITY_TYPES`** (a type there has no effective time at all and would vanish from "última actividad", `effectiveActivityTime.ts:64`); a parity test that `lusha_reveal` sits in the same set of lists as `call_attempt`; behavioral cases: a reveal does not move the derived stage, does not transfer ownership at the owner backfill, does not reset the follow-up clock, and still counts as last activity. Do NOT copy the `hunter_lookup` registration. (spec `lusha-reveal-audit`)
- [ ] 5.2 REFACTOR: move `actionFailure` from `actions.ts` into `actionErrors.ts` so both action files share one copy; existing tests stay green and no behavior changes. Commit before 5.3.
- [ ] 5.3 RED/GREEN: the single mapping table `LushaError.kind` -> `ContactActionErrorReason` in `actionErrors.ts`, exhaustive (every kind including `unparsable_value`, `cap_exceeded`, `busy`), plus `es`/`en` copy in `labels.ts` for each. Distinct copy for "the account is out of credits" versus "this person is protected".
- [ ] 5.4 RED/GREEN: the reveal orchestration with injected ports (the `runCatchUpExecute` / fakes pattern), tested without network: gate check -> `assertContactEditableById` (merged Contact refused) -> exactly one field per request -> email eligibility re-asserted server-side with `!isReachable` -> `resolveRevealState` -> `reserve` -> `client` call **outside** any transaction -> `settleSearch` / `settleReveal` / `failReservation`. Cases: disabled gate rejects server-side with no reservation written; a reachable email is refused even if the UI was bypassed; fake client returning 429, 5xx, timeout and 402 is called **exactly once** (no automatic retry) and the failed row keeps its reservation; `451` / `COMPLIANCE_RESTRICTED` settles as `compliance_restricted` and is permanent; `NOT_FOUND` settles as `no_match` with 0 credits; `ENRICH_FAILED` after a paid search keeps the paid search and is retryable without a second search; `unparsable_value` settles the charge and writes nothing to the Contact; errors never contain the key.
- [ ] 5.5 `src/app/(app)/contacts/lushaActions.ts`, thin `"use server"` shells over 5.4: `searchLushaContactAction`, `revealLushaFieldAction`, `rejectLushaMatchAction`, `getLushaAccountUsageAction`. Each: `getCurrentBd`, typed `{ ok, reason }` through `actionFailure` + `unstable_rethrow`, `revalidatePath`. The reveal action returns the duplicate warning payload (other Contact id and name) when present. `rejectLushaMatchAction` reachable only for an existing `matched` search and writes no credit. The account-usage action is free and its failure never blocks a reveal.
- [ ] 5.6 Docs: README documents `LUSHA_API_KEY` (production only), `LUSHA_DAILY_CREDIT_CAP` (default 12, `0` is a soft kill switch, raising it needs one Vercel variable plus a **redeploy**), the production gate, and the first-phone-reveal measurement note (0.7).
- [ ] 5.7 Confirm `tests/unit/lushaInert.test.ts` still passes: `lushaActions.ts` is the only `src/app` file mentioning Lusha, and nothing imports it.

Commits:
- `refactor(actions): share actionFailure between action files`
- `feat(activity): register lusha_reveal as status-neutral and no-progress`
- `feat(lusha): add reveal orchestration, server actions and error copy`

## Phase M: Mockup (docs-only, parallel track, gates PR 6)

Reachable: nothing. HTML and markdown only. This track can run in parallel with PRs 1-5 so that it never becomes the critical path, and it lands as its own docs commit.

- [ ] M.1 Produce HTML mockups under `openspec/changes/lusha-reveal/mockups/`, reusing `openspec/changes/crm-hubspot-ux/mockups/styles.css` (desktop only, 1280px; no mobile; no new CSS classes). Screens: (a) the reveal button on the email and phone rows with the text **Lusha badge** (`.badge .badge-outline .no-dot`, D16); (b) the **cost dialog** (search: 1 credit, may find nothing; first attempt shows the search-inclusive price); (c) the **matched-identity dialog** beside our own values, the price from `canReveal`, the day's remaining budget and the stale-able account balance, "No es mi contacto" as the secondary action; (d) the Lusha badge on the revealed value (email and ledger-derived phone); (e) the **duplicate-email warning** with the link to the other Contact; (f) the **cap-exhausted** state; (g) the **"buscar de nuevo"** state after a rejected match, stating its credit cost; plus the disabled/missing-key line and the compliance-blocked line.
- [ ] M.2 Add `mockups/README.md` listing each screen, the decision it illustrates (D2, D5, D6, D12, D16) and the existing classes used.
- [ ] M.3 **STOP**: owner reviews and approves (gate 0.3). Record the approval date in the README. Corrections are made here, not in PR 6.

Commits:
- `docs(lusha): add reveal control and dialogs mockup for review`

## Phase 6: UI (PR 6, base: main) - the only PR that makes anything reachable

**Start precondition: gate 0.3. Merge precondition: gates 0.4 and 0.5.** Reverting this single PR takes the control offline again; setting or removing `LUSHA_API_KEY` is the independent kill switch (0.6).

- [ ] 6.1 `page.tsx` wiring: load `getRevealState(personId)` (one query, at most three rows) server-side and pass the resolved state down `AboutPane` -> `PropertyList`; no client component decides what a reveal costs. When `getLushaConfig()` is `not_production` nothing renders; when `missing_env` a disabled control shows "LUSHA_API_KEY no configurada" (names only).
- [ ] 6.2 The reveal control in the email and phone rows of `PropertyList.tsx`, same slot as the inline-edit pencil, carrying the Lusha badge. The email control renders only when `!isReachable(person)`; a Contact that can already be sequenced is never offered a purchase. The phone control is independent of email reachability and both rows read the **same** search row, so a search paid from the phone row makes the email price visible for free. States render per `resolveRevealState`: searchable, revealable(price), rejected ("buscar de nuevo" with its cost), unavailable, capped (names the cap and the remaining budget), blocked (control disappears with an explanatory line).
- [ ] 6.3 Search dialog (existing `Dialog`, `settleAction`, toast pattern): states in words "1 credit, may find nothing"; confirm calls `searchLushaContactAction`; dismissing spends nothing.
- [ ] 6.4 Reveal dialog: matched identity (name, company, domain, LinkedIn) **beside our own values**, price from `canReveal`, the day's remaining budget (our ledger), account balance fetched on open via the free call and labelled possibly stale (never blocking), primary button is the only control that spends, "No es mi contacto" beside it. A revealed phone shows the raw value in the dialog when both columns were occupied (D11). The duplicate-email warning links to the other Contact's record and states that the pair was enqueued for the admin.
- [ ] 6.5 Lusha badge beside revealed values, next to the existing `badge-verified` / `badge-probable`; a revealed **phone** derives its badge from the ledger (no provenance column exists). The duplicate warning stays rediscoverable after the toast (spec `lusha-duplicate-email`).
- [ ] 6.6 `es`/`en` copy for all strings through the existing dictionary and the `ClientStrings` guard; existing classes only.
- [ ] 6.7 RED/GREEN: view-model tests for every state in 6.2 (including `match_rejected` offering retry, `compliance_restricted` offering nothing, email control hidden for a reachable Contact), and a test that every class used exists in the approved `styles.css` (spec "no new design tokens"). No client bundle contains `LUSHA_API_KEY` (key not in client payload).
- [ ] 6.8 Acceptance only (Playwright, 1280px, requires a real authenticated session; never where a cap or caching rule is verified): the control is absent in non-production, dialogs match the approved mockup states rendered from fixture state. The cap, cache, price and write rules live in the unit and integration layers.
- [ ] 6.9 INVERT `tests/unit/lushaInert.test.ts` into the positive assertions: `PropertyList` is the only component importing `lushaActions`, no `route.ts` mentions Lusha, `vercel.json` still has no Lusha entry, and the key is referenced only in `src/lib/lusha/config.ts`.
- [ ] 6.10 Owner checks the dialogs against the approved mockup in his local review, accepts the production-only visibility (0.5), then performs 0.6 and watches the first real reveal (0.7).

Commits:
- `feat(lusha): add reveal control and Lusha badge to the contact record`
- `feat(lusha): add search, reveal and reject-match dialogs with duplicate warning`

## Per-PR hygiene (applies to all 6)

- [ ] H.1 Each PR body carries a Chain Context section: start state, end state, prior dependencies, follow-up PRs, out-of-scope items, a dependency diagram marking the current PR with a pin marker, and the **reachability statement** from the table above. It does not replace the repo PR template; add any linked issue and `type:*` label it requires. (This repo pushes straight to `main` after a local review: commit locally and do not push until the owner reviews.)
- [ ] H.2 Conventional commits, work-unit commits (tests in the same commit as the behavior they verify, docs with the change they explain), no `Co-Authored-By` or AI attribution.
- [ ] H.3 Before each PR: `npm run typecheck`, `npm run test:unit`, and `git diff --stat` against `main` to confirm code lines are still within 400. A code overage stops and goes to the owner; a test/doc overage proceeds.
- [ ] H.4 Branch each PR off the freshly updated `main` after its predecessor merges. Never target another PR's branch (stacked-to-main).
- [ ] H.5 Strict TDD where the project supports it: RED test first for every RED/GREEN task. No test ever calls the Lusha API; `client.ts` takes `fetch` as a dependency so the suite cannot spend a credit.
- [ ] H.6 Generated artifacts, code, comments and UI identifiers stay in English except the Spanish UI copy that the existing dictionary already carries.

## Review Workload Detail

Estimates are lines changed. "Code" counts against the 400 budget; tests and docs do not.

| PR | Code | Tests | Docs | Fits 400 code? | Risk |
|---|---|---|---|---|---|
| 1 | ~190 | ~260 | ~5 | Yes | Low |
| 2 | ~290 | ~380 (+ fixtures) | ~5 | Yes | Low: parsers are small; fixtures are not code |
| 3 | ~120 | ~40 | ~10 | Yes | Low on size; **migration ordering gate 0.1/0.2** |
| 4 | ~350 | ~420 | ~5 | Yes (88%) | **At risk**: densest logic (lock, cap, settle transaction, duplicate write). Fallback: move the duplicate-candidate write (~60) and `rejectMatch` (~25) into PR 5, which has ~170 lines of slack |
| 5 | ~230 | ~250 | ~25 | Yes | Medium: touches live activity registries across ~8 files; the parity test with `call_attempt` is the mitigation |
| 6 | ~360 | ~150 | ~30 (mockups, README) | Yes (90%) | **At risk**: closest to the ceiling. Fallback: move the dialogs' `es`/`en` copy and the account-balance fetch (~50) into PR 5 |
| **Total** | **~1,540** | **~1,500** | **~80** | | |

If any code estimate exceeds 400 during apply, apply stops and asks the owner; the fallbacks above are the first options to offer. No `size:exception` is requested or recorded at planning time.

### Known trade-offs of this plan

- **UI visual review is limited to the mockup.** The production gate (D13) hides the control on preview and local, so the real control is first seen in production (gate 0.5). Mitigated by the approved mockup, per-state view-model tests and the small 5-credit-bounded blast radius (daily cap 12, soft kill switch `0`).
- **PR 6 is the only reachable PR by design**, and the key is a second, independent switch: merging PR 6 without `LUSHA_API_KEY` in production still shows nothing but the disabled line.
- **Migration ordering (gate 0.1) is a manual step**; the plan cannot enforce it mechanically.
- **The first phone reveal is also the parser verification** (0.7); a wrong shape costs 5 credits and writes nothing to the Contact, and the correction needs no second reveal.
- **Two migration chains are in flight** (`outreach-sequences` `0043`, this change `0044`); the number is re-checked at PR 3 time (0.2).
