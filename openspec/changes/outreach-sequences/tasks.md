# Tasks: Outreach Sequences

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~3,725 lines of CODE across 13 PRs, plus ~3,000 lines of tests and ~100 lines of docs (tests and docs do not count against the budget) |
| 400-line budget risk | High (8.5x+ a single PR); every individual PR is forecast at or under 400 lines of code |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 13 (see tables below) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (delivery and chain strategy already resolved by the owner)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Stacked-to-main**: every PR merges to `main` in order; the next PR branches off the updated `main`. There is no tracker branch and no PR targets another PR's branch. Rationale (owner): a 12-deep branch chain forces a rebase of every downstream PR on any upstream change and makes the final merge a conflict monster; the owner's criterion was "most efficient, no nasty merge conflicts later". Consequence of this strategy, which drives the whole plan: **every merge to `main` deploys to production**, so every PR except the last must be inert.

**Budget rule**: 400 lines of CODE per PR. Tests and docs do not count (owner rule); test/doc overage proceeds, code overage needs owner approval. Migration SQL and `schema.ts` count as code in the estimates below (conservative).

### The two hard safety rules, and how the plan enforces them

1. **The sending cron is absent from `vercel.json` until PR 13.** Not flagged off, not registered-but-disabled: absent. Also, `src/app/api/sequences/run/route.ts` does not exist until PR 13, and the runner logic in PR 9 is library code that no route imports. There is no path by which a real email leaves before PR 13.
2. **The "Secuencias" sidebar entry and every route that reaches this feature do not exist until PR 13.** No `page.tsx` under `/sequences`, no `route.ts` under `/api/sequences` or `/api/unsubscribe`, no sidebar entry, no mounted Contact-record block, no middleware exemption. UI components land earlier under a private `_components/` folder (Next.js App Router does not route `_`-prefixed folders) and are imported by nothing. Server actions land earlier but are imported by no component or page, so they are not exposed (Next 15 does not emit server actions that nothing references).

**Mechanical enforcement (task 1.1)**: PR 1 adds a unit test, `tests/unit/sequencesInert.test.ts`, that fails CI if any of these exist: a `vercel.json` cron containing `sequences`, any `page.tsx` or `route.ts` under `src/app/**/sequences/**`, `src/app/api/unsubscribe/**`, a "Secuencias" nav entry, or any file under `src/app` importing `@/lib/sequences/run*`. PR 13 inverts it into the positive assertions. This turns the safety rules from a promise into a failing test.

**Single go-live PR**: everything that makes the feature reachable is deliberately one atomic PR (13). Reverting that one PR takes the feature fully offline again (cron entry, routes, nav all go together).

### Suggested Work Units

| PR | Title | Slice | Base branch | Est. code lines | Gate |
|---|---|---|---|---|---|
| 1 | Data model: migration `0041`, schema, `email_account.id`, inertness guard | A | `main` | ~300 | **0.1 apply `0041` to prod BEFORE merge** |
| 2 | Pure core: `miamiTime`, `schedule`, `memberState`, `capValidation` | B | `main` | ~175 | TDD |
| 3 | Compliance core: migration `0042`, market-keyed `config`, `suppression`, `complianceFooter` | C | `main` | ~320 | **0.1 apply `0042`**; TDD |
| 4 | Unsubscribe core: token, queries, GET/POST handlers, pages (no route file) | C | `main` | ~240 | TDD |
| 5 | Roster: picker SQL builder, `rosterGuards`, create/add/remove/re-admit actions | D | `main` | ~320 | TDD |
| 6 | Drafting: `draftInput` (+ two `"en"` guards), batch/regenerate/edit, footer wiring | E | `main` | ~300 | TDD |
| 6b | Seed the first real sequence: owner-gated script, the 10 hand-picked contacts, re-validated | E | `main` | ~150 | TDD; **writes prod data, owner-gated** |
| 7 | Approval: review tracking, single + bulk approve with server gate, cancel, reminder approval | E | `main` | ~290 | TDD |
| 8 | Send path: `sendFromAccountRow`, `sendGmailMessageFromAccount`, `extraHeaders` | F | `main` | ~150 | TDD; **touches live send path** |
| 9 | Runner core: `releasePlan`, `preSendChecks`, claim, `runSequenceRelease` (no route, no cron) | F | `main` | ~310 | TDD |
| 10 | Replies: header parsing, `autoReply`, migration `0044`, `applySequenceReplies`, opt-out action | G | `main` | ~340 | **0.1 apply `0044`**; TDD; **touches live sync** |
| 11 | UI detail components (unmounted): view models, cards, stats, states | H | `main` | ~360 | Mockup conformance |
| 12 | UI dialogs and forms (unmounted): review dialog, bulk bar, list, create, Contact block | H | `main` | ~300 | Mockup conformance |
| 13 | **GO-LIVE**: pages, routes, cron, middleware, sidebar, badge, Contact mount | H | `main` | ~340 | **0.2-0.6 all ticked**; owner preview review |

### PR Chain

Order is the merge order. "Depends on" means the predecessor must already be merged to `main` (the next PR branches off updated `main`). Branch names follow `type/description` (`^(feat|fix|chore|docs|...)\/[a-z0-9._-]+$`).

| # | Branch | Contains | Depends on | Reachable by a user after merge |
|---|---|---|---|---|
| 1 | `feat/outreach-sequences-01-data-model` | `0041` + rollback, 4 tables + `email_account.id` in `schema.ts`, inertness guard test | none | Nothing |
| 2 | `feat/outreach-sequences-02-pure-core` | `miamiTime`, `schedule`, `memberState`, `capValidation` | 1 (merge order only; no code dependency) | Nothing |
| 3 | `feat/outreach-sequences-03-compliance-core` | `0042` + rollback, 2 tables, `config`, `suppression`, `complianceFooter`, market resolution | 1, 2 | Nothing |
| 4 | `feat/outreach-sequences-04-unsubscribe-core` | token module, queries, handlers, confirmation/invalid components, `List-Unsubscribe` header builder | 2, 3 | Nothing (no route file) |
| 5 | `feat/outreach-sequences-05-roster` | picker query builder, `rosterGuards`, roster actions | 2, 3 | Nothing (actions imported by no page) |
| 6 | `feat/outreach-sequences-06-drafting` | `draftInput`, generation/regeneration/edit actions, footer wiring | 3, 5 | Nothing |
| 7 | `feat/outreach-sequences-07-approval` | review flag, approve/bulk/cancel, reminder approval | 2, 6 | Nothing |
| 8 | `feat/outreach-sequences-08-send-path` | `sendFromAccountRow`, `sendGmailMessageFromAccount`, `extraHeaders` | 4 | Nothing new; existing `sendGmailMessage` callers see no change |
| 9 | `feat/outreach-sequences-09-runner-core` | `releasePlan`, `preSendChecks`, claim, orchestration | 3, 7, 8 | Nothing (no route, no cron) |
| 10 | `feat/outreach-sequences-10-replies` | `0044`, header parsing, `autoReply`, `applySequenceReplies`, "No contactar" action | 4, 9 | Nothing new; existing sync behavior unchanged |
| 11 | `feat/outreach-sequences-11-ui-detail` | view models and detail components under `_components/` | 7, 9 | Nothing (no `page.tsx`) |
| 12 | `feat/outreach-sequences-12-ui-dialogs` | review dialog, bulk bar, list/create components, Contact block component | 11 | Nothing (no `page.tsx`, not mounted) |
| 13 | `feat/outreach-sequences-13-go-live` | 3 pages, `/api/unsubscribe`, `/api/sequences/run`, 2 crons, middleware exemption, sidebar + badge, Contact mount | 1-12 | **Everything** (this is the switch) |

Dependency constraints from the design, all honored: A (PR 1) precedes everything; C (PRs 3-4) precedes E (PRs 6-7) because the footer needs the token table; F (PRs 8-9) precedes G (PR 10) because a reply needs a send to react to. PR 1 and PR 2 have no code dependency and may be developed in parallel, but they merge in numeric order.

### Per-PR reachability statement

Required by the owner for every PR. "Reachable" = a user or the internet can trigger it. "Inert" = exists in the deployed bundle but nothing can invoke it.

| PR | Becomes reachable | Stays inert |
|---|---|---|
| 1 | Nothing. `email_account.id` is a new column that existing code does not read; new tables are empty with RLS on and no policies. | Everything. |
| 2 | Nothing. | Four pure modules, imported only by tests. |
| 3 | Nothing. | Config, suppression and footer modules, imported only by tests. `email_suppression` and `sequence_unsubscribe_token` are empty. |
| 4 | Nothing. There is deliberately **no** `route.ts`, so no URL serves the handlers. | Token, queries, handlers, confirmation pages. |
| 5 | Nothing. Server actions are imported by no component, so they are not exposed. | Picker query, guards, actions. |
| 6 | Nothing. The generator is called only by actions that nothing imports. | Drafting actions. |
| 6b | Nothing. The script is run by hand, never imported, and has no route or cron. It writes 10 `sequence_member` rows in state `drafted` — approved by nobody, sent by nothing. | The seeded sequence and its drafts. |
| 7 | Nothing. | Approval actions, schedule extension. |
| 8 | Nothing new. `sendGmailMessage({ bdId })` keeps its exact behavior as a wrapper. | `sendGmailMessageFromAccount` has no caller. |
| 9 | Nothing. The runner is a library function with no route and no cron entry. **Note: after 6b, `sequence_member` is no longer empty** — the runner stays inert because nothing invokes it, and because `releasePlan` only releases `approved` members while all seeded rows are `drafted`. Both guarantees must hold; neither alone is sufficient. | `runSequenceRelease` and every pure module. |
| 10 | Nothing new for users. The sync additionally stores `is_automatic` and calls `applySequenceReplies`. **After 6b this no longer no-ops because the table is empty** — it no-ops because no seeded member has a `sent_at`, so there is no sent message for a reply to match. A task in 10 MUST assert that explicitly against seeded rows, not against an empty table. | Reply, opt-out and phrase logic. |
| 11 | Nothing. No `page.tsx` imports the components. | All components and the detail query. |
| 12 | Nothing. Not mounted anywhere, including the Contact record. | All components. |
| 13 | **The whole feature**: `/sequences`, `/sequences/new`, `/sequences/[id]`, `/api/unsubscribe`, `/api/sequences/run`, the two crons, the "Secuencias" nav entry and badge, the Contact-record block. | Nothing; gated by Phase 0 gates, not by code. |

## Phase 0: Gates and open blockers (NOT tasks to solve; checklist items that block merges)

- [ ] 0.1 **GATE (ordering, blocks PRs 1, 3, 10)**: apply each migration to production BEFORE the PR that declares its columns is merged. Drizzle selects every declared column, so merging `schema.ts` with `email_account.id` (PR 1) or `email_message.is_automatic` (PR 10) before the column exists breaks every existing query on `email_account` / `email_message`. Order per migration: `drizzle-kit generate`, review SQL, `migrate` against production, verify, then merge. `db:push` is never used (it leaves RLS off).
- [x] 0.2 **GATE — CLOSED 2026-10-14**: the Hallandale suite letter is **`Ste G`**, confirmed by the owner against the primary Florida record (`search.sunbiz.org`, "AVALITH CORPORATION", document `P18000083350`). The commercial aggregators reporting `Ste K` are wrong and must not be used. `src/lib/sequences/config.ts` therefore ships `Ste G` as a confirmed value — no `UNCONFIRMED` comment, no follow-up edit.
- [ ] 0.3 **GATE (blocks PR 13 merge, therefore the first real send)**: owner decides what to do about `AVALITH_PROFILE` claiming Miami offices (`src/lib/outreach/messagePrompt.ts:55`). Out of scope for this change; this is a decision, not a task. Drafts are sent automatically to US recipients, so it must be decided before the first send, not after.
- [ ] 0.4 **GATE (blocks PR 13 merge)**: counsel sign-off on advertisement disclosure and subject-line accuracy for generated copy (design preconditions). This plan gives no legal advice.
- [ ] 0.5 **GATE (blocks PR 13 merge)**: confirm `NEXT_PUBLIC_SITE_URL` is set in the production environment, or the owner accepts the `resolveSiteUrl()` fallback `https://bd-contact-intel.vercel.app` as the host baked into every unsubscribe link. Links already sent cannot be changed.
- [ ] 0.6 **GATE (blocks PR 13 merge)**: owner explicitly accepts the named limitation that an out-of-office reply still marks the Contact `replied` (existing sync behavior is intentionally unchanged) while the Sequence member correctly stays `sent`.
- [x] 0.7 Mar del Plata postal address string: supplied by the owner in `specs/sequence-compliance/spec.md` (Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina). **Both addresses are now final** — with 0.2 closed, no address item remains open and nothing about the compliance footer blocks any PR in this chain.
- [ ] 0.8 **GATE (ordering, blocks PR 13 merge)**: **PR 10 must be merged before PR 13.** The runner's "no genuine reply" check reads `sequence_member.replied_at`, and NOTHING writes that column until PR 10's `applySequenceReplies` (`email_message.is_automatic` does not exist until `0044` either). Until then a reply is invisible to the runner, so turning the switch on without PR 10 sends reminders to people who already answered — the worst failure mode this feature has, because it reads as not having opened your own inbox. Today this is harmless only because the runner is unreachable and all production members are `drafted`; unreachability is the ONLY thing stopping it (fresh review, PR 9, 2026-10-15). If PR 10 slips, the cheap hardening is to have `evaluatePreSendChecks` also hold when an inbound `email_message` or `reply_received` activity exists from that Contact after the step 1 send.
- [ ] 0.9 **GATE (blocks PR 13 merge)**: five hardening items deferred from PR 9's fresh review, each harmless while the runner is unreachable and each reachable the moment PR 13 lands:
  - `MAX_CANDIDATES = 500` is applied BEFORE the pre-send checks, and a hold never changes member state, so permanently held approved members (suppressed, client company, unmapped market, missing footer, pending claim) stay candidates forever and can crowd out every newer sendable member with nothing signalling why. Exclude them in SQL or log when the cap is hit.
  - A lost claim (`!claimId`) is counted as nothing, so the concurrency story is invisible in the run summary. Count it as `deferred` or add a `lost` field.
  - The inert guard matches only the `@/lib/sequences/…` alias, so a relative import (`./runSequenceRelease`) would slip past it.
  - Subject and body come from the candidate read, so a BD who edits and re-approves between the read and the claim still has the OLD text sent. The claim could re-check `d.approved_at = c.approvedAt`.
  - Step 2's SQL orders by raw `reminder_due_at` while `toCandidate` derives the release instant through `reminderReleaseAt`, so the two orderings can diverge near the 500 boundary.

## Phase 1: Data Model (PR 1, base: main)

Reachable: nothing. Inert: all of it.

- [ ] 1.1 RED/GREEN: `tests/unit/sequencesInert.test.ts` asserts, by reading the repo tree and `vercel.json`: no cron path containing `sequences`; no `page.tsx`/`route.ts` under any `sequences` directory in `src/app` or under `src/app/api/unsubscribe`; no "Secuencias" entry in the sidebar nav source; no file under `src/app` importing `@/lib/sequences/run`. This test is the mechanical form of the two hard safety rules and is inverted in 13.7.
- [ ] 1.2 Write `drizzle/0041_outreach_sequences.sql`: `sequence`, `sequence_member`, `sequence_draft`, `sequence_send_claim` per design D2/D10 (`unique(sequence_id, person_id)`; `unique(sequence_member_id, step)`; partial unique `(sequence_member_id, step) WHERE outcome <> 'failed'`; index `(sending_account_id, miami_send_date) WHERE outcome = 'sent'`; `(sequence_id, state)` and `(person_id)` indexes). No `is_active` column. `schedule jsonb not null`. `daily_send_cap integer not null default 5`. `state` is free text, no CHECK (repo convention).
- [ ] 1.3 In the same migration: `ALTER TABLE email_account ADD COLUMN id uuid DEFAULT gen_random_uuid()`, then `SET NOT NULL`, then `ADD CONSTRAINT … UNIQUE (id)`. Keep `bd_id` as the primary key (D3). The volatile default rewrites the table and assigns distinct ids per existing row.
- [ ] 1.4 RLS inside the migration: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for each of the four new tables, with **no policies** (the posture of `0019_enable_rls.sql` and `0040`; the app connects as `postgres` with BYPASSRLS and never reads through PostgREST, so RLS with no policies denies `anon` and `authenticated` outright).
- [ ] 1.5 Write `drizzle/0041_outreach_sequences_rollback.sql` (the convention since `0028`).
- [ ] 1.6 Mirror the four tables and `email_account.id` in `src/db/schema.ts`; run `drizzle-kit generate` and confirm it produces no further diff against the hand-written SQL.
- [ ] 1.7 Verification (against a local/staging DB, then production per 0.1): `relrowsecurity` is true for all four tables; every existing `email_account` row has a distinct non-null `id`; rollback restores the prior shape; `npm run typecheck` and `npm run test:unit` green.

Commits:
- `test(sequences): guard that no sequence route, cron or nav entry exists yet`
- `feat(sequences): add sequence tables and email_account.id with RLS enabled`

## Phase 2: Pure Core (PR 2, base: main)

Reachable: nothing. Inert: four pure modules imported only by tests.

- [x] 2.1 RED/GREEN: `src/lib/sequences/miamiTime.ts` (`miamiCalendarDate`, `miamiWallClockToUtc`, `nextMiamiNineAm`) using `Intl.DateTimeFormat` with `America/New_York` (D8). Required cases: `2026-11-01` approval gives `2026-11-02 09:00 Miami = 14:00 UTC` (not 13:00); both 2026 transitions (March 8 spring-forward, November 1 fall-back); approval at `23:50` Miami still schedules the next calendar day. The file states the opposite assumption to `argentinaDate.ts` in its doc comment; do not touch `argentinaDate.ts`.
- [x] 2.2 RED/GREEN: `src/lib/sequences/schedule.ts`: `step1DueAt(approvedAt)`, `reminderDueAt(step1SentAt)` (7 days after the actual send, so a cap-delayed send pushes the reminder), and `parseSchedule()` reading the `schedule` jsonb with the spec's values as the fallback.
- [x] 2.3 RED/GREEN: `src/lib/sequences/memberState.ts`: `canTransition(from, to, trigger)` encoding the `sequence-approval` table exactly. Required rejections: `sent -> approved`, `replied -> sent`, any exit from `sent` caused by an auto-reply, re-admit of an `opt_out` discard.
- [x] 2.4 RED/GREEN: `src/lib/sequences/capValidation.ts`: `validateDailySendCap` accepts 1-15 integers, rejects `0`, `-3`, `2.5`, `500`, returns a warning flag above 8, default 5.

Commits:
- `feat(sequences): add DST-correct Miami schedule calculations`
- `feat(sequences): add member state machine and cap validation`

## Phase 3: Compliance Core (PR 3, base: main)

Reachable: nothing. Inert: modules imported only by tests; both new tables empty.

- [x] 3.1 Write `drizzle/0042_email_suppression.sql` + `_rollback.sql`: `email_suppression` (`kind`, normalized `value`, `source`, `recorded_by_bd_id` nullable, `person_id`, `sequence_member_id`, `unique(kind, value)`, **no `bd_id`**) and `sequence_unsubscribe_token` (`token_hash` unique, `sequence_member_id`, `email_normalized`, `used_at`). `ENABLE ROW LEVEL SECURITY` on both, no policies. Mirror in `schema.ts`.
- [x] 3.2 RED/GREEN: `src/lib/sequences/config.ts`: the **single** source of the postal address and opt-out text, keyed by recipient market per `sequence-compliance`: `us` -> Avalith Corporation, 470 Ansin Blvd Ste G, Hallandale, FL 33009, USA (suite confirmed against the Florida record, see 0.2); `latam` -> Avalith, Formosa 2531, B7600 Mar del Plata, Buenos Aires, Argentina. `other` has **no entry**. Test: changing a configured address changes the footer with no other file edited.
- [x] 3.3 RED/GREEN: `recipientMarket(contact)` (pure) resolving a Contact to `latam | us | other` through the existing `classifyMarket` (`src/lib/hiring/markets.ts`). Confirm with the owner during apply which Contact field feeds it (`classifyMarket` takes a location string); any location it cannot resolve MUST map to `other` (fail safe, it holds rather than sends).
- [x] 3.4 RED/GREEN: `complianceFooter.ts`: `buildFooter(config, market, unsubscribeUrl)` returns the market's address + opt-out text + link, or an explicit `unmapped` result for `other` (never a default address); `bodyHasFooter(body, config, market)` is false for `other`. Required cases: model output with no address still gets the footer; the footer is on the reminder too; a body where the BD deleted the address fails the check.
- [x] 3.5 RED/GREEN: `suppression.ts`: `isSuppressed(address, rules)` and `normalizeSuppressionValue` (reusing `normalizeNeverLogValue`, one normalization rule). Required cases: `Jane@Acme.com` against `jane@acme.com`; domain rule `acme.com`; no match. `SuppressionRule` and `NeverLogRule` are distinct types so one cannot be handed to the classifier.
- [x] 3.6 Thin DB layer `suppressionQueries.ts` (list rules, insert idempotently with `ON CONFLICT DO NOTHING`).
- [x] 3.7 Test: no `@avalith.net` literal exists under `src/lib/sequences/` outside tests and fixtures (spec "No hardcoded address").

Commits:
- `feat(sequences): add company-wide email suppression table and matcher`
- `feat(sequences): add market-keyed compliance footer and postal address config`

## Phase 4: Unsubscribe Core (PR 4, base: main)

Reachable: nothing. There is intentionally **no** `route.ts`; the handlers exist but no URL serves them until PR 13.

- [x] 4.1 RED/GREEN: `unsubscribeToken.ts`: `generateUnsubscribeToken` (`randomBytes(32).toString("base64url")`), `hashUnsubscribeToken` (sha256); the hash differs from the token and is deterministic; malformed input is rejected before any lookup.
- [x] 4.2 RED/GREEN: pure `handleUnsubscribeGet` decision: valid token -> `confirm` view model; unknown or malformed -> generic `invalid` view model that names no address; **performs zero writes** (asserted with a fake port that throws on any write).
- [x] 4.3 GREEN: `unsubscribeQueries.ts`: lookup by `token_hash` (one indexed read); `ensureTokenForMember` (one row per member, reused by the reminder footer); `suppressByToken` in **one transaction**: insert `email_suppression` `ON CONFLICT (kind, value) DO NOTHING`, set `used_at` if null, move every non-terminal membership for that address to `discarded` with reason `opt_out` and a null actor (using `canTransition`). The repeat POST changes nothing.
- [x] 4.4 RED/GREEN: `handleUnsubscribePost` accepts both the confirmation-page form and the RFC 8058 one-click body (`List-Unsubscribe=One-Click`, `application/x-www-form-urlencoded`) with no form token or referer check; repeat POST renders the same confirmation.
- [x] 4.5 Pure `buildUnsubscribeHeaders(url, senderAddress)` returning the `List-Unsubscribe` (https URI first, then `mailto:`) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` strings consumed by PR 8/9.
- [x] 4.6 Confirmation, success and invalid page components from `mockups/baja-opciones.html` (Opcion B screens 2 and 3), existing design-system classes only, copy from a dictionary slice. Not routed.
- [x] 4.7 Integration script (seeded local DB, not the unit suite): two concurrent POSTs for one token yield one suppression row; GET writes nothing.

Commits:
- `feat(sequences): add hashed unsubscribe tokens and idempotent suppression write`
- `feat(sequences): add unsubscribe handlers and confirmation pages`

## Phase 5: Roster (PR 5, base: main)

Reachable: nothing. Actions are imported by no page or component.

- [ ] 5.1 RED/GREEN: `rosterQuery.ts` (pure SQL builder): not merged, non-empty email, `email_status <> 'none'`, `email_source <> 'pattern_inferred'`, company has an open IT posting (`is_it`, `closed_at` null) in the US market, `client_status` null (excludes `active` AND `inactive`), not suppressed, "Florida" label from `job_posting.is_miami`; **no** `is_startup` filter or ranking.
- [ ] 5.2 RED/GREEN: `rosterGuards.ts`: per-Contact accept/reject with an explicit reason code: unreachable, `company_limit` (max 2 non-discarded per `person.company_key`), `client`, `suppressed`, `duplicate`. Required cases: discarded members do not count toward the limit; bulk add of 3 at one company reports each rejected Contact with a reason and drops none silently.
- [ ] 5.3 GREEN: `rosterQueries.ts` thin DB layer.
- [ ] 5.4 Actions: `createSequence` (name required; sending account chosen only from accounts the BD owns, referenced by `email_account.id`; cap through `validateDailySendCap`), `addMembers`, `removeMembers` (reason required, actor recorded, bulk applies one reason), `reinstateMember` ("Reincorporar": returns to `drafted`, clears `approved_at`, re-runs every guard, rejects an `opt_out` discard). Every guard is enforced server-side, not only in the UI.
- [ ] 5.5 `updateSequenceSettings` (cap edit takes effect on the next run).

Commits:
- `feat(sequences): add roster picker query and guardrails`
- `feat(sequences): add create, add, remove and re-admit roster actions`

## Phase 6: Drafting (PR 6, base: main)

Reachable: nothing. The generator is called only by actions that nothing imports.

- [x] 6.1 RED/GREEN: `draftInput.ts`: language is market-keyed (owner decision 2026-10-14, supersedes the original "always en"): `draftLanguageForMarket` us -> `"en"`, latam -> `"es"`, other -> `null` (no draft, member held). `buildSequenceDraftInput(args, market)` is the only function the drafting actions and the reminder job call. Tests: the mapping, a US member can never be drafted in Spanish, and language/footer agree for every market.
- [x] 6.2 RED/GREEN: import-allowlist test in the style of `tests/unit/argentinaDayBoundariesUsage.test.ts`: fails if any file under `src/lib/sequences/` or the sequence actions calls `runGenerateOutreachMessage` without going through `buildSequenceDraftInput`. Design finding recorded in the commit body: `buildOutreachEmailPrompt` is dead code; drafting goes through the live `runGenerateOutreachMessage` with `channel: "email"`.
- [x] 6.3 Signals: `extractOutreachSignals` runs over the SAME object handed to the prompt; chips are derived from it, never from model output. Test: no chip for a signal not in the input; no-signal member still gets a generic draft.
- [x] 6.4 Footer wiring: `buildFooter` is appended AFTER generation (never requested from the model); for a market that resolves to `other` NO draft is generated (no language, no address); the member is held with `hold_reason = unmapped_market` (3.4). `ensureTokenForMember` supplies the unsubscribe URL via `resolveSiteUrl()`.
- [x] 6.5 Actions: "Generar borradores faltantes" (sequential loop, per-member try/catch, never `Promise.all` because the prod pool is `max: 3`; skips members that already have a draft and any draft with `edited_at` set); "Regenerar" single and bulk (replaces the draft, clears reviewed, returns an `approved` member to `drafted`); save-without-approving (sets `edited_at/by`, clears reviewed, withdraws approval, returns a warning if the footer was removed).
- [x] 6.6 RED/GREEN: edit protection: an edited draft is byte-identical after a missing-drafts batch; one generator failure among ten leaves nine drafts and a retryable member.
- [x] 6.7 Reminder draft (owner decision 2026-10-14: additive `purpose` on the live prompt, rules 1 and 3 only, reference style keyed by language): `generateReminderDraft` (called by the runner in PR 9 after a step 1 send), same edit protection and regenerate rules, short nudge with no invented claims. **Open point for apply**: the live prompt may need a minimal additive purpose parameter; if satisfying it would alter the prompt's ten rules, stop and ask the owner instead of forking it.

Commits:
- `feat(sequences): pin draft language to English behind guarded input builder`
- `feat(sequences): add batch, regenerate and edit-protected draft actions`

## Phase 6b: Seed the first real sequence (PR 6b, base: main)

Reachable: nothing. Inert: the seeded sequence and its drafts — 10 members in state `drafted`, approved by nobody, sent by nothing.

**Why here and not later**: by PR 6 the tables (1), the roster guards (5) and the draft generator (6) all exist. Seeding at this point exercises the whole A→E pipeline against production data before a single screen exists, and it means PR 13's preview shows the owner's real list instead of an empty state. Owner decision 2026-10-14.

**Why its own PR**: PR 6 is already forecast at ~300 code lines with a flagged risk; folding ~150 more in would breach the 400-line budget.

The roster is the 10 contacts the owner approved on 2026-10-14 (see `mockups/README.md`), in tier order: Brian Casteel and Saumya Jossy (Upshop), Adrian Pulido (Nubank), Joe Dilaura and Melissa Dominguez (Snowflake), Kevin Harris and Stefano Fontanelli (Twilio), Jose Velez and Anderson Romero (Bold), Andy Ellis (Cint).

- [x] 6b.1 RED/GREEN: pure `resolveSeedRoster(candidates, guards)` in `src/lib/sequences/seedRoster.ts` — takes the hand-picked list plus live row state and returns `{ admitted, rejected }` with a reason per rejection. Unit-tested over every rejection path. No DB access.
- [x] 6b.2 `scripts/seed-outreach-sequence.ts`, following the owner-gated convention of `scripts/clear-non-company-employers.ts`: `--dry-run` is the default and prints the full plan; `--apply --actor=<bd id>` is required to write; one `audit_log` row per applied run, never on a no-op; the whole write in one `db.transaction`.
- [x] 6b.3 **Re-validate every candidate at run time; never substitute silently.** The hand-picked list was measured on 2026-10-14 and this runs weeks later. Each member is admitted only if, at run time: the person is non-merged and still has a non-empty `email`; their company still has an open IT posting; `company.client_status` IS NULL (owner decision: `inactive` is a past client and gets no cold outreach); the address is not in `email_suppression`; and the max-2-per-company cap still holds. Anyone who drops off is **reported by name with the reason** and left out — the script must not quietly pick a replacement to reach 10.
- [x] 6b.4 Idempotent: a second run against the same sequence name adds nothing and writes no audit row. Re-running after a member was removed by hand does NOT re-add them.
- [x] 6b.5 Create the sequence named `Florida + US · octubre` (the mockup's name), owned by the owner's bd id, `sending_account_id` referencing their connected `email_account`, `daily_send_cap` 5, and the two-step schedule from `sequence-scheduling`.
- [x] 6b.6 Generate each member's draft through the real PR 6 path, so the seeded drafts are the genuine article — English (`"en"`), market-keyed footer, real signals. Do NOT hand-write draft text.
- [x] 6b.7 Every member lands in state `drafted`. The script MUST NOT set `approved_at`, `sent_at`, or anything that could be released. Assert this in the test.
- [x] 6b.8 (applied 2026-10-14 with owner approval: 9 members `drafted`, 9 step-1 drafts; the first apply drafted none because of an expired OIDC token and a 500-token output cap that reasoning consumed) Verification: run `--dry-run` against production and show the owner the admitted/rejected split BEFORE `--apply`. Then `npm run test:unit` and `npm run typecheck` green.

Commits:
- `feat(sequences): add pure seed-roster resolution with per-candidate rejection reasons`
- `feat(sequences): add owner-gated script seeding the first real sequence`

## Phase 7: Approval (PR 7, base: main)

Reachable: nothing. Approval actions are imported by no page.

- [x] 7.1 RED/GREEN: `bulkApprovalGate.ts`: "N de M" gate; cases 1-of-3 (disabled), 3-of-3 (enabled), 3-of-4 after selection change (disabled).
- [x] 7.2 Action `markDraftReviewed` (called when the dialog opens; passive listing never marks).
- [x] 7.3 Actions `approveMember` (single approve is not gated by the counter) and `approveBulk` (server re-asserts the gate; rejects the whole request naming any unreviewed member; forged request approves none). Approval records actor and time, binds to current content, computes `scheduled_for` via `step1DueAt`.
- [x] 7.4 RED/GREEN: reject a step 1 subject beginning with `Re:` or `Fwd:` at approval, with an explanation.
- [x] 7.5 Action `cancelApproval` ("Cancelar envio"): back to `drafted`, `approved_at` cleared.
- [x] 7.6 RED/GREEN: reminder approval is independent of step 1; reminder release instant is the first run at or after BOTH 7 days after the send and the next 09:00 Miami after approval (cases: approved 08:00 on due day releases that day; approved 10:00 waits for the next day); "Adelantar recordatorio" moves the due date but never bypasses approval, the reply check, or the cap. Extends `schedule.ts` from PR 2.
- [x] 7.7 Every approve, cancel, discard, re-admit and regenerate writes the actor BD and timestamp (test per action).

Commits:
- `feat(sequences): add review tracking and server-enforced bulk approval gate`
- `feat(sequences): add reminder approval and release timing`

## Phase 8: Send Path (PR 8, base: main; touches the live send path)

Reachable: nothing new. Existing callers of `sendGmailMessage({ bdId })` must see identical behavior.

- [x] 8.1 RED: characterization tests pinning today's `sendGmailMessage` behavior (token refresh, error classification, `recordSentEmail`) BEFORE refactoring.
- [x] 8.2 REFACTOR: extract the body into `sendFromAccountRow(account, input)` (D4); `sendGmailMessage({ bdId })` becomes a thin wrapper loading by `bdId`. Characterization tests stay green.
- [x] 8.3 GREEN: `sendGmailMessageFromAccount({ accountId, ... })` loads by `email_account.id`; sender address comes from the row, never a literal.
- [x] 8.4 RED/GREEN: `buildRawMessage` gains `extraHeaders?: string[]`, each value through `assertSafeHeaderValue` (header-injection test with CR/LF).
- [x] 8.5 Sequence metadata (Sequence id, step) flows into the `email_sent` activity metadata through the existing `recordSentEmail` path; reminder threading uses the stored `In-Reply-To`/`References`/`threadId` inputs.

Commits:
- `refactor(gmail): extract send body into sendFromAccountRow behind characterization tests`
- `feat(gmail): add send-by-account-id entry point and extra headers`

## Phase 9: Runner Core (PR 9, base: main)

Reachable: nothing. **No `route.ts` and no `vercel.json` change in this PR.** `runSequenceRelease` is a library function with no importer under `src/app`.

- [x] 9.1 RED/GREEN: `syncFreshness.ts` `isSyncFreshEnough`; `null` -> stale; constant `SEQUENCE_SYNC_STALE_MS = 26h` in `config.ts` with the design's explanatory comment.
- [x] 9.2 RED/GREEN: `releasePlan.ts` `planSequenceRelease`: budget per sending account per Miami day = `max(0, min(caps of sequences with candidates) - sentToday)`; order by `dueAt`, then `approvedAt`, then `id`. Required cases: 8 approved / cap 5 / 0 sent releases 5 and defers 3 with no hold written; cap already consumed; cap lowered mid-day below what is sent; two Sequences on one account (lower cap wins); reminders share the cap; failed sends not counted; run before 09:00 releases nothing.
- [x] 9.3 RED/GREEN: `preSendChecks.ts` one function, one `HoldReason` union, every re-check: member and draft still approved; Contact not merged and still has an email; not suppressed; company `client_status` null; `bodyHasFooter`; account `status = 'connected'`; **recipient market is mapped (`other` -> hold with an unmapped-market reason, never send)**; for reminders only: no genuine reply, sync fresh, and a stored `rfc_message_id` for step 1 (otherwise `no_thread_headers`). Held members never count against the cap.
- [x] 9.4 GREEN: `releaseQueries.ts` (candidates in one read, `sentToday` per account from the indexed read) and claim: `INSERT … ON CONFLICT DO NOTHING` before the Gmail call, proceed only if the insert returned a row; a `pending` claim with no outcome is never auto-resent and surfaces as `hold_reason = 'manual_check'`; a `failed` claim stays as history.
- [x] 9.5 RED/GREEN: `runSequenceRelease` orchestration with injected ports (the repo's `runCatchUpExecute` pattern, tested with fakes): `reauth_required`/`not_connected` halts that ACCOUNT for the run and leaves its members `approved`; `temporary`/`send_failed` affects only that member; no tight retry; post-send sets `miami_send_date`, step 1 -> `reminderDueAt` and `generateReminderDraft`, step 2 -> `no_reply`; returns `{ released, held, deferred, failed }`. Status follows existing `deriveStatus`; nothing new sets it.
- [x] 9.6 Integration script (seeded local DB): two concurrent runs with one approved due member send exactly one email; a pending claim is not re-sent.
- [x] 9.7 Update `tests/unit/sequencesInert.test.ts` expectations only if needed; it must still pass (no route, no cron).

Commits:
- `feat(sequences): add pure release planning and pre-send checks`
- `feat(sequences): add claim-before-send runner core without a route or cron`

## Phase 10: Replies (PR 10, base: main; touches the live Gmail sync)

Reachable: nothing new for users. **Gate 0.1: apply `0044` (`0043` went to `lusha_reveal` on 2026-10-14) to production before merging.** Existing sync behavior for `reply_received` and derived status is unchanged by design.

- [ ] 10.1 Write `drizzle/0044_email_message_is_automatic.sql` + `_rollback.sql`: `email_message.is_automatic boolean not null default false` (no backfill needed; historical rows default correctly). Mirror in `schema.ts`.
- [ ] 10.2 RED/GREEN: extend `parseGmailMessage` with `autoSubmitted`, `precedence`, `autoreplyHeaderPresent` through the existing `findHeader`.
- [ ] 10.3 RED/GREEN: `autoReply.ts` `isAutomaticMessage`: `Auto-Submitted` other than `no`; `X-Autoreply`/`X-Autorespond`/`X-Auto-Response-Suppress`; `Precedence` of `auto_reply`/`bulk`/`junk`; mailer-daemon/postmaster sender; subject-prefix fallback. Required cases: `Auto-Submitted: auto-replied`; subject "Out of Office: Re: senior engineers" with no headers is automatic; "Re: senior engineers" with a vacation body is NOT automatic.
- [ ] 10.4 `classifyGmailMessage` carries `isAutomatic`; the sync persists it to `email_message.is_automatic`. Existing `reply_received` writes are untouched (regression test).
- [ ] 10.5 RED/GREEN: `applySequenceReplies(storedMessages)`: moves `sent`/`no_reply` -> `replied` only for a non-automatic inbound message FROM the member's Contact dated after the step 1 send; Cc-only does not count; a message before the send does not count; a never-logged message cannot count; auto-reply then human reply sets `replied_at` to the second message; withdraws any pending or approved reminder; **never writes `follow_up_queue_item`**.
- [ ] 10.6 Wire `applySequenceReplies` as a post-write hook in the sync inside its own try/catch so a Sequence failure can never break the sync; a no-op while `sequence_member` is empty.
- [ ] 10.7 RED/GREEN: `optOutPhrases.ts` advisory detection ("unsubscribe", "remove me", "stop emailing", "no more emails"); detection never suppresses by itself.
- [ ] 10.8 Action `recordOptOut` ("No contactar"): suppresses the address and discards all memberships with reason `opt_out`, reusing the PR 4 transaction (covers replies that skip the link).

Commits:
- `feat(sync): detect automatic messages from headers and persist the flag`
- `feat(sequences): move members to replied on genuine replies and record opt-outs`

## Phase 11: UI Detail Components (PR 11, base: main)

Reachable: nothing. Components live under `src/app/(app)/sequences/_components/` (a private folder that is not routed); **no `page.tsx` is added**.

- [ ] 11.1 RED/GREEN: `stats.ts`: the four stat cards, progress segments and finished-state counts. Mockup dataset (3 drafted, 2 approved, 3 sent without reply, 1 replied after being sent, 1 discarded) yields 3, 2, 4 (3 awaiting reminder), 1 and "4 de 10 ya salieron"; discarded members count in the total but not among the unanswered.
- [ ] 11.2 RED/GREEN: pure card mapper: state + hold reason + reminder-due -> badge, meta line, action set, for all six states in the `sequence-detail-view` table (including "Recordatorio hoy"); held members show their reason; replied cards offer no approve or reminder action.
- [ ] 11.3 `getSequenceDetail` query, owner-scoped; an admin read of another BD's Sequence writes an `audit_log` row (admin, owner BD, timestamp) before returning draft bodies, following `getConversationForAdmin`.
- [ ] 11.4 Components: header with "Aprobar los N listos", Cadencia card, stat cards, progress line, member cards, empty state ("N contactos, ningun borrador todavia" + "Generar los N borradores"), finished state ("Secuencia completa"). `sequences` dictionary slice (`es`/`en`) with the `ClientStrings` guard for client components. Existing classes only (`.stat`, `.empty`, `.assoc`, `.chip`, badges); no new CSS.
- [ ] 11.5 Test: every class used by the components exists in the approved design system `styles.css` (spec "no new design tokens").

Commits:
- `feat(sequences): add stat, progress and member-card view models`
- `feat(sequences): add detail page components and Spanish copy`

## Phase 12: UI Dialogs and Forms (PR 12, base: main)

Reachable: nothing. Not mounted on any page, including the Contact record.

- [ ] 12.1 `ReviewDialog` (one dialog for "Revisar borrador", "Ver correo", "Ver correo enviado", "Revisar recordatorio"): "Leelo antes de aprobar", "Senales usadas" chips, read-only "Para", "Desde" from the account row, editable "Asunto"/"Cuerpo" including the visible footer, per-contact "Cadencia", edit-protection help text, footer actions "Regenerar" / "Guardar sin aprobar" / "Aprobar y programar"; read-only for `sent`/`replied`/`no_reply`; reminder variant states the intro date and that no reply has been seen since; opening calls `markDraftReviewed`.
- [ ] 12.2 `BulkBar`: "N seleccionados", "N de M borradores revisados", "Regenerar los N", "Quitar de la secuencia" (one reason for all), "Aprobar y programar los N" disabled until N = M using `bulkApprovalGate`.
- [ ] 12.3 List component and create form with roster picker (Florida badge, per-Contact rejection reasons, cap field with the domain-reputation warning above 8).
- [ ] 12.4 `SequenceContext` Contact-record block (membership + state) and the "No contactar" control, plus the advisory opt-out prompt on replied cards. Built but **unmounted**.
- [ ] 12.5 Test: the bulk-bar view model disables approve at 1-of-3 and enables it at 3-of-3.

Commits:
- `feat(sequences): add review dialog and bulk approval bar components`
- `feat(sequences): add list, create form and contact-record block components`

## Phase 13: GO-LIVE (PR 13, base: main) - the only PR that makes anything reachable

**Merge precondition: gates 0.2, 0.3, 0.4, 0.5, 0.6 are all ticked and 0.1 is satisfied for `0041`-`0042` and `0044`.** Reverting this single PR takes the entire feature offline. Vercel crons run only on production deployments, so the owner reviews the pages on the PR's preview deployment with no cron in play.

- [ ] 13.1 Pages (thin composition of the existing components): `/sequences`, `/sequences/new`, `/sequences/[id]`; owner-scoped; admin read audited. Route naming stays English with Spanish UI copy (D12); the words "Campana"/"Campaign" appear nowhere.
- [ ] 13.2 `src/app/api/unsubscribe/route.ts`: `GET` renders only, `POST` suppresses, using the PR 4 handlers and the same Drizzle/`postgres` client (never supabase-js, or RLS would block it).
- [ ] 13.3 `src/app/api/sequences/run/route.ts`: `isValidBearer(authHeader, process.env.CRON_SECRET)`, 401 on missing header, wrong header, or unset secret; `dynamic = "force-dynamic"`, `maxDuration = 300`; calls `runSequenceRelease`; not triggerable by a user session.
- [ ] 13.4 `vercel.json`: register the runner twice, `0 13 * * *` and `0 14 * * *` (D9). This is the first and only place the cron appears.
- [ ] 13.5 Middleware: rename `CRON_ROUTES` to `SESSION_EXEMPT_ROUTES` in `src/lib/supabase/middleware.ts` and add `/api/unsubscribe` and `/api/sequences/run`, keeping exact-match-or-slash-prefix so `/api/unsubscribe-admin` is NOT exempt (test).
- [ ] 13.6 Sidebar "Secuencias" entry directly below "Seguimientos" with a pill count; add the sixth scalar subquery `sequence_count` (the BD's Sequences with at least one member outside `{replied, no_reply, discarded}`) to `buildAppShellBadgeCountsQuery` so the shell still costs one round trip. Mount the `SequenceContext` block on the Contact record.
- [ ] 13.7 INVERT `tests/unit/sequencesInert.test.ts` into the positive assertions: the cron appears exactly twice, both routes exist and are session-exempt, the nav entry exists.
- [ ] 13.8 Acceptance (Playwright, 1280px only, requires a real authenticated session; acceptance only, never the TDD loop): detail page six card states, review dialog, bulk gate, sidebar badge. No cap, cadence or suppression rule is verified here; those live in the unit layer.
- [ ] 13.9 Owner reviews the pages against `mockups/secuencia-detalle.html` and `mockups/baja-opciones.html` on the preview deployment, and checks the unsubscribe confirmation page on the preview (GET writes nothing; POST suppresses).

Commits:
- `feat(sequences): add sequence pages and public unsubscribe route`
- `feat(sequences): register the sequence runner cron and expose Secuencias in the sidebar`

## Per-PR hygiene (applies to all 13)

- [ ] H.1 Each PR body carries a Chain Context section: start state, end state, prior dependencies, follow-up PRs, out-of-scope items, a dependency diagram marking the current PR with a pin marker, and the **reachability statement** from the table above. It does not replace the repo PR template; if the template requires a linked issue and a `type:*` label, add them.
- [ ] H.2 Conventional commits, work-unit commits (tests in the same commit as the behavior they verify, docs with the change they explain), no `Co-Authored-By` or AI attribution.
- [ ] H.3 Before opening each PR: `npm run typecheck`, `npm run test:unit`, and `git diff --stat` against `main` to confirm the code-line count is still within 400. A code overage stops and goes to the owner; a test/doc overage proceeds.
- [ ] H.4 Branch each PR off the freshly updated `main` after its predecessor merges. Never target another PR's branch (stacked-to-main).

## Review Workload Detail

Estimates are lines changed. "Code" counts against the 400 budget; tests and docs do not.

| PR | Code | Tests | Docs | Fits 400 code? | Risk |
|---|---|---|---|---|---|
| 1 | ~300 | ~60 | ~10 | Yes | Medium: the SQL plus `schema.ts` is dense but mechanical; sits at 75% |
| 2 | ~175 | ~260 | ~5 | Yes | Low |
| 3 | ~320 | ~330 | ~10 | Yes | Medium: gained market resolution (+40 over the design's ~280) |
| 4 | ~240 | ~200 | ~10 | Yes | Low (the design's ~260 minus the route file, which moved to PR 13) |
| 5 | ~320 | ~280 | ~5 | Yes | **At risk**: picker builder + four actions; the audited admin read was moved to PR 11 to keep it down |
| 6 | ~300 | ~300 | ~10 | Yes | **At risk**: the reminder-prompt question (6.7) is unresolved and could add lines |
| 6b | ~150 | ~160 | ~10 | Yes | Low on size; **writes production data**, so it is owner-gated with a dry run shown before `--apply` |
| 7 | ~290 | ~280 | ~5 | Yes | Low |
| 8 | ~150 | ~150 | ~5 | Yes | Low on size; **high consequence** (live send path), mitigated by characterization tests first |
| 9 | ~310 | ~420 | ~10 | Yes | **At risk**: gained the unmapped-market check; densest logic in the chain |
| 10 | ~340 | ~320 | ~10 | Yes | **At risk**: gained the opt-out action and phrase detection (+60 over the design's ~280); touches the live sync |
| 11 | ~360 | ~220 | ~5 | Yes (90%) | **At risk**: closest to the ceiling. Fallback: move the empty and finished states to PR 12, which has ~100 lines of slack |
| 12 | ~300 | ~120 | ~5 | Yes | Medium |
| 13 | ~340 | ~140 | ~10 | Yes | **At risk**: cannot be split without making something reachable early. Fallback: move the `sequence_count` subquery (~40 lines, harmless unused scalar) into PR 12 |
| **Total** | **~3,895** | **~3,240** | **~110** | | |

If any code estimate exceeds 400 during apply, apply stops and asks the owner; the pre-agreed fallbacks above are the first options to offer. No `size:exception` is requested or recorded at planning time.

### Known trade-offs of this plan

- **Visual review is deferred to PR 13.** Because UI components are unmounted until go-live, the owner (who tests only on Vercel) cannot see PRs 11-12 in a running app. Mockup conformance for those two PRs is verified by view-model unit tests, the class-existence test (11.5) and code review; the real visual review is the PR 13 preview. A UI defect found there is fixed in PR 13 or a follow-up, not by reopening PR 11/12.
- **PR 13 is the largest blast radius by design**, and that is the point: one switch, one revert.
- **Ordering of migrations versus deploy (gate 0.1)** is a manual step the owner or apply agent must perform; the plan cannot enforce it mechanically.
