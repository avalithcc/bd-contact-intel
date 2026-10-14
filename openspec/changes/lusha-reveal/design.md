# Design: Lusha Contact Reveal

**Decision in one line**: one additive `lusha_reveal` ledger table where the **search is a first-class paid row** next to the email and phone reveal rows; every spend is reserved in that ledger under a short advisory lock *before* the HTTP call, every UI state is derived from the **latest** ledger row per field by a pure resolver, and the revealed value lands through its own planner that writes `emailStatus='probable'` / `emailSource='lusha'` so the Contact becomes Sequence-eligible without ever touching `updateContactProperty`.

Specs: `specs/lusha-reveal-action`, `lusha-reveal-ledger`, `lusha-credit-cap`, `lusha-identity-match`, `lusha-reveal-write`, `lusha-duplicate-email`, `lusha-production-gate`, `lusha-error-handling`, `lusha-reveal-audit` (written in parallel, authoritative). Proposal: `proposal.md`. Measured API facts: engram `#560` (live probe, 2 credits spent). Owner decisions: `#553`, `#557`, plus the hybrid-caching and rejected-match decisions of 2026-10-14. Design system and shell: inherited from `crm-hubspot-ux`, **no new CSS classes**.

## Quick path for reviewers

1. **D1, D4 and D7** are the load-bearing ones: the ledger shape, how a retry stays possible without ever paying twice, and how two simultaneous clicks cannot exceed the cap.
2. **The reveal flow** below is where the lock, the claim and the two confirmations meet.
3. **Review Workload Forecast** revises the proposal's 3 PRs / ~800-1,000 lines upward, and says which PR is the first one a BD can reach.

## Architecture decisions

| # | Topic | Choice | Rejected alternative | Why |
|---|---|---|---|---|
| D1 | Ledger shape | **One** `lusha_reveal` table, one row per paid event, discriminated by `field ∈ {'search','emails','phones'}` — the search is a ledger row like any other, carrying the Lusha contact id, the matched identity and the `canReveal` price list in a `payload` jsonb | (a) two tables (`lusha_contact_match` + `lusha_reveal`); (b) columns on `person` | The daily cap is `sum(credits)` over **every** charging event, and a search charges. With two tables that sum is a UNION of two aggregates on every click; with one table it is one indexed range scan. (b) cannot represent "we paid and Lusha had nothing" at all (R2), which is exactly the row that stops the second charge. jsonb for the match snapshot follows the `activity.metadata` / `sequence.schedule` precedent — nothing queries inside it, the UI only renders it. |
| D2 | Interaction shape | **Two steps, two confirmations**: "Buscar en Lusha" (1 credit, may find nothing) then, once the match is on screen, "Revelar email · N créditos" | (a) one action that chains search + enrich; (b) auto-chain when the matched domain equals ours, confirm only when fuzzy | The probe measured fuzzy matching on our own population: 6 of 25 matched a different domain and one (`aument.io` → "Aumenta GT" at `www.aumenta.do`, different LinkedIn slug) was a genuinely different company. A one-shot action spends the reveal credit on that wrong person with no human in the loop, and cannot show the price before spending — which matters precisely because phone is 5× email (R3). (b) invents a confidence score that is ours, not Lusha's, and still needs the second click for the 5-credit case, so it buys nothing and adds a rule nobody asked for. |
| D3 | Caching strategy | **Hybrid**: the first attempt on a Contact pays search + reveal (~2 credits); the search outcome is cached in the ledger and reused for *both* fields, so every later reveal on that Contact costs only the reveal | (a) one search per click (the proposal's assumption); (b) a batch discovery job searching 25 Contacts for 1 credit (the `#560` suggestion) | (a) pays the search credit forever — ~2 credits per email against a 40-credit pool. (b) is genuinely cheaper (1 credit per 25) but it is **bulk**, which the proposal puts out of scope in writing, and it spends credits on Contacts nobody asked about. Hybrid keeps the one-contact-at-a-time contract and still pays the search exactly once per Contact. The 1-credit-per-25-results billing stays a documented future optimization, not a hidden one. |
| D4 | Retry vs. never-pay-twice | The ledger holds **many rows per (person, field) over time**; the UI state and every spend decision read the **latest** row per field. The only unique index is **partial on in-flight rows**: `unique (person_id, field) WHERE state = 'reserved'` | A permanent `unique (person_id, field)` used as cache key, tombstone and claim in one (the proposal's §3) | The owner's rejected-match decision (2026-10-14) makes a permanent tombstone wrong: the usual cause of a bad match is a **wrong company domain on our side**, and once that is corrected the Contact must not stay trapped. A permanent unique index would make "buscar de nuevo" structurally impossible. Splitting the two jobs costs nothing: "never pay twice" is a *read* of the latest row (a settled `matched` search is reused, a settled `revealed` value is served from the ledger), while "never double-charge a double click" is the *write* guard — and one in-flight reservation per (person, field) is exactly what the partial index allows. Same `onConflictDoNothing().returning()` primitive as `sequence_send_claim` (outreach-sequences D10), same partial-index trick, inverted predicate. |
| D5 | Recording a rejected match | The BD's "No es mi contacto" **updates the latest search row** to `outcome='match_rejected'` with `rejected_by_bd_id` / `rejected_at`, charging nothing. "Buscar de nuevo" then inserts a **new** search row and pays a new search credit against the global cap | Appending a separate zero-credit `match_rejected` row | The ledger's invariant is **one row per paid event** — that is what makes `sum(credits)` trustworthy as the cap counter and as the spend audit. A rejection is not a paid event, and attaching it to the row whose credit bought that match keeps "what did this credit buy" answerable in one row. The append-only purity is already gone anyway (reserve → settle is an update). **The rejection never touches `credits_charged`**: that search really was billed, so a rejected-match row keeps counting against the day's cap exactly like a matched one (see D7). |
| D6 | What is permanent | **Only** a compliance block (HTTP `451`, or a per-contact `COMPLIANCE_RESTRICTED`) is permanent: no retry, no "buscar de nuevo", the control disappears with an explanatory line. `no_match`, `no_value` and `match_rejected` are all manually retryable at the price of a new search | Treating `no_match` / `no_value` as permanent too (the proposal's edge case) | A person protected from this kind of lookup is protected tomorrow as well, and retrying is both pointless and a GDPR-posture problem. "Lusha has nothing" is a fact about a snapshot of Lusha's index and about the identity we sent it — both change. The protection against clicking it twice by accident is not a constraint, it is the UI: the control stops offering itself automatically, and the retry is an explicit, separately-worded action that states its credit cost. |
| D7 | Cap enforcement and the race | Reserve-before-call inside a short transaction that takes `pg_advisory_xact_lock(LUSHA_CAP_LOCK)`: the lock, the day's `sum`, the staleness re-check and the claim insert are **one** atomic unit; the HTTP call happens after it commits, never under the lock | (a) a `lusha_daily_spend` counter row with a conditional `UPDATE ... WHERE spent + cost <= cap`; (b) `SERIALIZABLE` + retry; (c) a unique index, like `sequence_send_claim`; (d) `GET /v3/account/usage` | A unique index answers "has this exact unit been claimed?" — a per-row question. The cap is an **aggregate over rows that do not exist yet**, and under READ COMMITTED two concurrent `SELECT sum(...)` both miss the other's uncommitted insert; no unique index can bound a SUM. (a) works but creates a second source of truth for spend that immediately drifts, because the API's real charge differs from the estimate (a no-match charges 0). (b) has no precedent in this repo and needs retry plumbing. (d) is disqualified by measurement: `/v3/account/usage` is **eventually consistent** — right after a charging call it still reported the old balance. It may be displayed, never trusted. The lock is held for one round trip on a human-paced action; the prod pool is `max: 3` and reveals are rare. |
| D8 | Unknown outcome after a charge | A transport failure, timeout or `5xx` after the reservation settles the row as `state='failed'` with `credits_charged = null`, and the **reserved amount keeps counting against that day's cap** | Releasing the reservation (deleting the row, or zeroing it) | A timeout is the one case where we cannot know whether Lusha charged, and we cannot ask (D7(d)). Of the two possible errors — counting a charge that never happened, or missing one that did — only the second can empty a 40-credit pool. The cost of being conservative is bounded and visible: the ledger shows a `failed` row with its `error_code`, and the owner can raise the cap. The `failed` row does **not** block a retry (D4: it falls out of the `state='reserved'` predicate). |
| D9 | Cap configuration | One env var `LUSHA_DAILY_CREDIT_CAP`, default **12**, parsed by a pure `parseDailyCreditCap()` that falls back to the default on anything unparseable and accepts `0` as a soft kill switch. Global only; `actor_bd_id` is recorded for visibility, never read by the cap | (a) a per-BD cap alongside the global one; (b) a DB settings row with an admin UI | (a) was revised away by the owner (`#557`): *"quien va a usar más eso seguramente sea Mariel. No dividiría el consumo."* It also made phone reveal arithmetically impossible at 5 credits. (b) needs settings infrastructure that does not exist for a number that changes a handful of times a year. The honest cost of the env var: raising the cap when the plan goes paid is one Vercel variable **plus a redeploy**, no code change. A NaN must never become `Infinity` — the parse fails toward the default, never toward unlimited. |
| D10 | The write path | A dedicated pure planner `planRevealedEmailWrite()` / `planRevealedPhoneWrite()` producing `{ personUpdate, historyRows }` in the exact shape `planPropertyEdit` produces, applied by `revealDb.ts`. Eligibility for an email reveal is `!isReachable(person)` — the **negation of the Sequences roster guard**, imported from `src/lib/sequences/rosterGuards.ts` and re-asserted server-side | (a) `updateContactProperty`; (b) adding a `source` parameter to `planPropertyEdit` | (a) hardcodes `emailStatus='none'` / `emailSource='manual'`, which `isReachable` rejects — the blocker this change exists to solve (R8). (b) would let any caller declare arbitrary provenance on the manual path, whose entire premise is "a human typed it, so it is unverified". Reusing `isReachable` as the eligibility predicate means the reveal can only ever overwrite an address the Sequences gate already refuses (empty, `none`, or `pattern_inferred`) — a verified or already-probable email is never destroyed, and the rule lives in one place for both features. |
| D11 | Which phone column | Lusha's phone type picks the target (`mobile` → `mobilePhone`, anything else → `phone`); if that column is occupied the other one is used when empty; if **both** are occupied nothing is overwritten — the value stays in the ledger and the dialog shows it for the BD to place by hand. The type field itself is unmeasured, so the rule is provisional by construction — see **D17** | Always writing `phone`; overwriting whichever column is "worse" | `person` has no `phoneStatus`/`phoneSource` (verified), so the ledger is the only provenance a revealed phone will ever have and a silent overwrite is unrecoverable from the UI. Two populated numbers is a human decision, not a rule worth inventing; the BD already paid 5 credits and still gets the value. The non-destructive branch is three lines in a pure planner and is unit-tested. |
| D12 | Duplicate revealed email | Write the value **and** insert a `duplicate_candidate` row (`reason='lusha_reveal_email'`, `matchKey` = the normalized email, pair ordered by id, `onConflictDoNothing`), and return the other Contact's id and name so the dialog warns and links to it | (a) block the write; (b) write silently | Owner decision (`#557`, HubSpot behaviour): the spend must still produce something. **Finding that changes the mechanics**: `/admin/duplicates` is `requireAdmin()`-gated (`src/app/(app)/admin/duplicates/page.tsx:178`), so a BD cannot be "sent to the merge flow" — the honest implementation is to warn, link to the other Contact's record (which every BD can open), and enqueue the pair into the queue an admin already works. No unique index is added on `person.email`: the base predates any such rule and would fail the migration; the duplicate check is a normalized-email read inside the settle transaction, which leaves a narrow TOCTOU window whose worst outcome is a missing candidate row, not corrupted data. |
| D13 | Config and the production gate | One `getLushaConfig()` returning `{ ok: true, config }` \| `{ ok: false, reason: 'not_production' }` \| `{ ok: false, reason: 'missing_env', missing: string[] }`, gated on `process.env.VERCEL_ENV === 'production'`, reporting variable **names** only | `NODE_ENV === 'production'`; throwing on a missing key | Vercel preview deploys also run with `NODE_ENV=production`, so a `NODE_ENV` gate lets every preview branch spend real credits (R5); the existing `localDevGuard`/`instrumentation.ts` guards only cover `NODE_ENV=development` and do not cover this. Returning instead of throwing is the `getGmailOAuthConfig()` contract verbatim: the UI renders a real explanation and no request is ever built with `undefined` in the header. The two failure reasons are deliberately distinct — `not_production` renders nothing (the feature does not exist locally), a missing key in production renders a disabled control with the reason, because that one is a misconfiguration somebody must see. |
| D14 | Error taxonomy | `LushaError { kind }` with one mapping table into the existing `ContactActionErrorReason` union, and **no automatic retry anywhere**. `reveal` is a **required positional parameter** of `enrichContact()`, not an option with a default | A generic "integration failed" reason; a retry wrapper on `5xx`/`429` | A retry on a paid endpoint is a second charge — the `GatewayError` precedent in `generateMessage.ts` already maps distinct codes to distinct keys without retrying. The nine BD-facing outcomes (`401/402/403/429/451`, `NOT_FOUND`, `COMPLIANCE_RESTRICTED`, `ENRICH_FAILED`, plus the async `job` response) each need their own copy: "the account is out of credits" and "this person is protected" demand opposite reactions from the BD. Making `reveal` a required parameter turns R9 into a **type error** rather than a convention — omitting it on v3 returns both fields and silently costs 5 extra credits. |
| D15 | Activity-type registration | `lusha_reveal` goes in **exactly two** semantic lists — `STATUS_NEUTRAL_ACTIVITY_TYPES` and `NO_PROGRESS_ACTIVITY_TYPES` — plus `TIMELINE_ACTIVITY_TYPES` and the `system` pill group for rendering. That is `call_attempt`'s registration, byte for byte | (a) copying the `hunter_lookup` registration; (b) also adding it to `NON_TOUCH_ACTIVITY_TYPES` | A reveal must not move the Contact's stage and must not reset the follow-up clock — but it **is** work somebody did on that Contact, so it must keep counting as "última actividad". Those three requirements are exactly the two lists: `STATUS_NEUTRAL` holds the stage, `NO_PROGRESS` holds ownership and the clock together (one list, two consumers, `noProgressActivity.ts:5-13`). (a) is in **neither**, so copying it would make buying an email **transfer Contact ownership** at the next owner backfill and **reset the follow-up clock** — the silent-loss failure `noProgressActivity.ts:15-22` documents. (b) is the trap worth naming so nobody re-adds it: `NON_TOUCH_ACTIVITY_TYPES` (`effectiveActivityTime.ts:64`) is `task_*` **only**, and it does not mean "not progress" — a type in it has **no effective time at all**, which would silently delete the reveal from the last-activity column and from every query that orders by it. `call_attempt` is deliberately not in it, and neither is this. |
| D16 | Lusha branding | A **text badge** reading "Lusha" built from the existing `.badge .badge-outline .no-dot` classes, on the action button and beside the revealed value | Shipping the Lusha logo as an SVG asset | "Visibly branded so the BD understands it spends real money" is satisfied by the word. A third-party wordmark is a trademark-usage question nobody has answered and the first new image asset in a CSS-class-only design system — the project rule is one design language everywhere. The badge beside the value is what keeps the spend legible after the fact. |
| D17 | The unmeasured phone response | Phone ships in the first slice with `pickPhone` **failing closed**: an entry that does not match the expected shape produces the typed outcome `unparsable_value`, writes **nothing** to `person.phone`/`mobilePhone`, and still settles the ledger row with the real `credits_charged`. The **raw `phones[]` payload is persisted on the ledger row** (`payload`, D1) on every phone attempt, so the first production reveal is the measurement | (a) spending 5 credits on a probe before writing the parser; (b) shipping email first and phone in a second change; (c) a permissive parser that writes whatever string it finds | The owner declined (a) — 5 of the remaining 38 credits on a shape that one real reveal will show for free — and declined (b) in `#553`, because a phone is worth 5× an email to a BD. That makes the **first real phone reveal the verification**, which is only acceptable if it cannot lose the thing it is verifying: persisting the raw array means a wrong `pickPhone` or a wrong column rule (D11) is corrected from stored data, in a follow-up PR, **without spending a second 5-credit reveal**. (c) is the one unacceptable option: 5 credits spent and a garbage string written into a dialable field the BD will trust. Charging honestly while writing nothing is the correct asymmetry — the money is gone either way, the data integrity is not. |

## The reveal flow

```
BD clicks the Lusha control on the email or phone row
      │
      ▼
getLushaConfig()  ── not_production ──► control not rendered at all
      │            ── missing_env    ──► disabled + "LUSHA_API_KEY no configurada"
      ▼ ok
resolveRevealState(latest row per field)   (PURE)
      ├─ revealed            ──► value served from the ledger, no network, no charge
      ├─ compliance blocked  ──► permanent, no control (D6)
      ├─ search still valid  ──► skip straight to the reveal step
      ▼ needs a search
┌─ reserve(field='search', expected = 1) ──────────────── ONE transaction ─┐
│  pg_advisory_xact_lock(LUSHA_CAP_LOCK)                                    │
│  sum(coalesce(credits_charged, credits_reserved)) over today  (AR day)    │
│      + expected > cap                       ──► cap_exceeded, nothing written
│  re-read the latest search row (it may have been rejected meanwhile)      │
│  INSERT ... ON CONFLICT DO NOTHING RETURNING  ── no row ──► busy (D4)     │
└───────────────────────────────────────────────────────────────────────────┘
      ▼ committed as `reserved`, lock released
POST /v3/contacts/search   body { contacts:[{ clientReferenceId: personId, … }] }
      │   header api_key · AbortSignal.timeout(15s) · no retry
      ├─ transport / 429 / 5xx ──► state='failed', error_code, reserved credits stay spent (D8)
      ▼
settle: outcome matched|no_match · credits_charged = billing.creditsCharged
        payload = { lushaContactId, name, company{name,domain}, socialLinks, canReveal[], requestId }
        matched by clientReferenceId, NEVER by array index (results are not order-stable)
      ▼
dialog shows the matched identity beside OUR values, the price from canReveal, the day's
remaining budget (our ledger, authoritative) and the account balance (free call, labelled stale-able)
      ├─ "No es mi contacto" ──► latest search row ► outcome='match_rejected' (0 credits, D5)
      │                          control stops offering itself; "Buscar de nuevo" pays a new search
      ├─ canReveal has no 'emails' ──► "Lusha no tiene email para este contacto", no spend offered
      ▼ BD confirms the identity and the price
reserve(field='emails'|'phones', expected = canReveal.credits)     ── same guard, same lock
      ▼
POST /v3/contacts/enrich   body { ids:[lushaContactId], reveal:["emails"] }   ← required param (D14)
      ▼
settle ── ONE transaction ──────────────────────────────────────────────────┐
   ledger    │ state='settled', outcome revealed|no_value|compliance_restricted,            │
             │ credits_charged from billing (a no-match is a measured 0), value, payload     │
   person    │ email, emailNormalized, emailStatus='probable', emailSource='lusha',          │
             │ emailConfidence  ── or the phone column chosen by D11                          │
   history   │ one person_property_history row per changed column, source='lusha_reveal'      │
   activity  │ type 'lusha_reveal', actorBdId, metadata { field, creditsCharged, lushaId }    │
   duplicate │ duplicate_candidate when the normalized email is live on another Contact (D12) │
└──────────────────────────────────────────────────────────────────────────────┘
```

The activity row is inserted **directly**, not through `createActivityInTx`: the type is status-neutral by construction (D15), so the status recompute that helper triggers would be a wasted read — exactly the reasoning `callAttemptDb.ts:7-10` already records for `call_attempt`.

## Data model

One additive migration with its `_rollback.sql` twin (the convention since `0028`). `npm run db:push` is never used; the migration ends with `ALTER TABLE lusha_reveal ENABLE ROW LEVEL SECURITY` and **no policies**, the posture of `0019` and `0040`.

**Numbering: `0044_lusha_reveal`.** `0041` and `0042` are on disk; `0043` is reserved by outreach-sequences PR 10 (`email_message.is_automatic`), planned and not yet merged. The two changes are in flight together, so the number **must be re-checked against `drizzle/` at implementation time** — if the sequences chain slips and `0043` is still free when this lands, this migration takes `0043` and the sequences one moves up. Renumbering is a file rename plus the matching rollback twin; applying two files with the same prefix is not.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `person_id` | uuid not null → `person(id)` cascade | |
| `field` | text not null | `'search'` \| `'emails'` \| `'phones'`. Free text validated at the write boundary — repo convention (`client_status`, `contact_type`), no CHECK. |
| `state` | text not null default `'reserved'` | `'reserved'` \| `'settled'` \| `'failed'`. The lifecycle, not the result. |
| `outcome` | text | null while reserved. Search: `matched` \| `no_match` \| `match_rejected`. Reveal: `revealed` \| `no_value` \| `compliance_restricted`. |
| `value` | text | The selected email/phone. Null on every other outcome. |
| `value_normalized` | text | Lowercased email / digits-only phone — the duplicate check reads this, not `value`. |
| `credits_reserved` | integer not null | The expected price at reservation time: 1 for a search, `canReveal.credits` for a reveal. Never a hardcoded price table. |
| `credits_charged` | integer | null until settled, then `billing.creditsCharged` — authoritative, overrides the estimate. `0` is a real, measured value. |
| `lusha_contact_id` | text | From the search; copied onto reveal rows so one row explains itself. |
| `payload` | jsonb not null default `'{}'` | Matched identity, `canReveal` snapshot, the **full** `emails[]`/`phones[]` arrays and `requestId`. Storing the whole array means a later change to the selection rule costs no credits. |
| `actor_bd_id` | uuid → `bd(id)` set null | Visibility only (`#557`), never read by the cap. |
| `rejected_by_bd_id`, `rejected_at` | uuid, timestamptz | D5. |
| `error_code` | text | The `LushaError` kind on a `failed` row, so budget consumed by a failure is explainable. |
| `at` | timestamptz not null default now() | **Reservation** time. The cap attributes a charge to the day it was reserved, so a settle crossing midnight never moves it. |
| `settled_at` | timestamptz | |

Indexes:

- `unique (person_id, field) WHERE state = 'reserved'` — the double-click guard and nothing else (D4). `onConflictDoNothing({ target: [personId, field], targetWhere: sql\`state = 'reserved'\` })`.
- `(person_id, field, at desc)` — serves the record page's `DISTINCT ON (field)` latest-row read in one scan.
- `(at)` — serves the cap's daily `sum`, which deliberately counts **every** row of the day whatever its outcome: settled reveals, settled searches, searches whose match the BD later rejected (D5), `no_match` rows (which charge a measured 0 and therefore cost the budget nothing), and `failed` rows at their reserved amount (D8). The cap counts credits **charged**, never credits that produced something useful.
- **Not** added: `(actor_bd_id, at)`. There is no spend dashboard in this slice; the index is a one-line migration the day there is one.

`person_property_history.source` gains `'lusha_reveal'` — free text with a documented vocabulary in a schema comment (`schema.ts:858-865`), so only the comment changes. `activity.type`'s comment gains `lusha_reveal` the same way.

## Pure / DB split

The established pattern (pure module unit-tested under `tests/unit/`, thin DB twin beside it). Nothing in the left column imports `@/db`.

| Pure (`src/lib/lusha/`) | What it decides | DB / IO twin |
|---|---|---|
| `config.ts` | env → `{ ok, config }` \| `not_production` \| `missing_env` (D13) | — (reads `process.env` only) |
| `cap.ts` | `parseDailyCreditCap`, `evaluateCap({ spentToday, cap, expected })` → allow / `cap_exceeded` + remaining | `revealDb.getDailySpend()` |
| `pricing.ts` | `expectedCost(field, canReveal)` — from the API's own prices; a reveal with no cached `canReveal` is refused, never guessed | — |
| `parse.ts` | `matchByClientReferenceId`, `parseSearchResponse`, `parseEnrichResponse`, `pickEmail`/`pickPhone` (work type first, then confidence, then first — deterministic, never element zero) | — |
| `errors.ts` | HTTP status + per-contact code → `LushaError.kind` → `ContactActionErrorReason` | — |
| `revealPlan.ts` | `planRevealedEmailWrite`, `planRevealedPhoneWrite` (D10, D11) → `{ personUpdate, historyRows, activity }` | `revealDb.settleReveal()` |
| `revealState.ts` | latest rows + cap + config → the control's state: `off` \| `unconfigured` \| `searchable` \| `revealable(price)` \| `unavailable` \| `rejected` \| `blocked` \| `revealed(value)` \| `capped` | `revealDb.getRevealState()` |
| `client.ts` | the two REST calls; takes the key and a `fetch` dep as **arguments**, never reads `process.env` | it *is* the IO edge; parsers are separate so they test against fixtures |

`revealDb.ts` holds exactly four writes — `reserve()` (advisory lock + cap + staleness + claim), `settleSearch()`, `settleReveal()` (the big transaction), `failReservation()` — plus `rejectMatch()` and two reads. The day window comes from the existing business timezone helpers (`argentinaDayBoundaries`, `src/lib/tasks/argentinaDate.ts`), **not** UTC and not Lusha's `resetsAt`, which tracks request limits rather than credits.

Server actions live in a new `src/app/(app)/contacts/lushaActions.ts`, following the folder's existing per-concern split (`bulkActions.ts`, `messageActions.ts`) rather than growing the 500-line `actions.ts`: `searchLushaContactAction`, `revealLushaFieldAction`, `rejectLushaMatchAction`, `getLushaAccountUsageAction`. Each one is the established shape — `"use server"`, `getCurrentBd`, `assertContactEditableById`, typed `{ ok, reason }` through `actionFailure` + `unstable_rethrow`, `revalidatePath`. `actionFailure` moves from `actions.ts` into `actionErrors.ts` so both files share one copy.

## UI surface

Desktop only (project rule). Server-rendered state, dumb client components: `page.tsx` loads `getRevealState(personId)` (one query, at most three rows) and passes it down `AboutPane` → `PropertyList`, so no client component ever decides what a reveal costs.

The control sits in the **email and phone rows of `PropertyList.tsx`**, in the same slot as the existing inline-edit pencil. The email control only renders when `!isReachable(person)` (D10) — a Contact that can already be sequenced is never offered a purchase. The phone control is independent of email reachability, and both rows read the **same** search row, so a search paid from the phone row makes the email price visible for free.

The confirm dialog follows the existing `QuickActions` pattern (`Dialog`, `settleAction`, toast). It shows, in this order: the matched identity (name, company, domain, LinkedIn) **beside our own values** so a mismatch is visible rather than inferable, the price from `canReveal`, the day's remaining budget from our ledger, and the account balance fetched on dialog open through the free `/v3/account/usage` call — labelled as possibly stale and never blocking the reveal if it fails. Its primary button is the only control in the feature that spends. "No es mi contacto" sits beside it as a secondary action.

Revealed values render the Lusha text badge next to the existing `badge-verified` / `badge-probable` badges. A revealed **phone** has no provenance column (D11), so its badge is derived from the ledger — which is the whole reason the page reads the ledger rather than only `person`.

## Error taxonomy

| Source | Condition | `LushaError.kind` | BD-facing meaning |
|---|---|---|---|
| HTTP | 401 | `bad_key` | configuration problem, not the BD's |
| HTTP | 402 | `no_credits` | the **account** is out of credits |
| HTTP | 403 | `plan_denied` | the plan cannot use v3 |
| HTTP | 429 | `rate_limited` | try later — never auto-retried, no `Retry-After` scheduling |
| HTTP | 451 | `compliance_blocked` | this person cannot be revealed. **Permanent** (D6) |
| HTTP | 5xx / network / timeout | `unavailable` | see D8: the day's budget keeps the reservation |
| 200 body | `NOT_FOUND` | `not_found` | Lusha does not know this person |
| 200 body | `COMPLIANCE_RESTRICTED` | `compliance_restricted` | permanent, same copy as 451 |
| 200 body | `ENRICH_FAILED` | `enrich_failed` | retryable |
| 200 body | an async `job` | `async_unsupported` | fails cleanly — no polling subsystem (proposal, out of scope) |
| 200 body | a value whose shape `pickEmail`/`pickPhone` does not recognise | `unparsable_value` | "Lusha devolvió un dato que no pudimos leer" — the credit **was** charged and is recorded, and nothing is written to the Contact (D17) |
| local | cap reached | `cap_exceeded` | names the cap and the remaining budget |
| local | reservation conflict | `busy` | a reveal for this field is already running |

Every kind maps to one reason in `ContactActionErrorReason` through a single table in `actionErrors.ts`, and to `es`/`en` copy in `labels.ts`. `WATERFALL_NOT_IN_PLAN` (measured on the free plan, returned with `status: "partial"`) is **not** an error: the reveal succeeded with what the base providers had.

## Testing strategy

| Layer | Target |
|---|---|
| Unit (strict TDD) | `parseDailyCreditCap` on `""`/`"abc"`/`"-1"`/`"0"`/`"50"`; `evaluateCap` at exactly-at-cap and one-under with a 5-credit phone; `expectedCost` refusing a reveal with no cached `canReveal`; `matchByClientReferenceId` against a **reordered** results array; `pickEmail`/`pickPhone` with multiple entries and with none; `planRevealedEmailWrite` producing `emailStatus='probable'` + `emailSource='lusha'` **asserted through the real `isReachable`**, not restated; `planRevealedPhoneWrite` with each column free, one free, both occupied; `resolveRevealState` for all nine states, including `match_rejected` → offers retry and `compliance_restricted` → offers nothing; the error mapping table, exhaustively |
| Fixtures | The probe's real responses, with emails/phones redacted, committed under `tests/unit/fixtures/lusha/`. They are the only way to test a paid API's shapes without paying again, and they are the regression net if Lusha changes the contract |
| Integration (seeded local DB, not the unit suite) | two concurrent `reserve()` calls on the same (person, field) → exactly one row; two concurrent reveals that together exceed the cap → exactly one proceeds; a `failed` row does not block a later reserve; the settle transaction rolling back leaves no `person` write |
| E2E | Acceptance only, 1280px, after owner approval of the mockup. Never where a cap or caching rule is verified |
| Production | The first real phone reveal **is** the measurement of the `phones[]` shape (D17). Its raw payload lands on the ledger row, so the correction is a data read plus a parser PR, not a second 5-credit spend. `pickPhone` is unit-tested against a deliberately wrong shape to prove it fails closed |

No test ever calls the Lusha API. `client.ts` takes `fetch` as a dependency precisely so the suite cannot spend a credit by accident.

## Named limitations, stated on purpose

- **Rejecting a match does not roll back an already-written value.** The rejection exists to stop the *next* spend; a value already written is corrected through the normal property edit, with `person_property_history` keeping both.
- **The search credit is spent before the identity can be shown.** The identity *is* the search result, so "show the match before any spend" can only ever mean "before the reveal spend". The search dialog says so in words: 1 credit, may find nothing.
- **A conservative cap can lose budget it never spent** (D8). Visible in the ledger as `failed` rows; the fix is the cap, not the accounting.
- **No spend dashboard.** The ledger makes one possible; this slice ships the cap so the question never becomes urgent.
- **Local review never exercises the integration** (D13). Accepted tradeoff of the production gate; it raises the value of the error surface and of the fixtures.
- **Batch discovery at 1 credit per 25 is left on the table** (D3). Documented, not hidden, and it is purely additive on top of this ledger.
- **Bounces on `probable` revealed addresses** are a downstream Sequences/deliverability concern, out of scope here.

## Review Workload Forecast

| PR | Slice | Content | Est. code lines | 400 risk |
|---|---|---|---|---|
| 1 | Pure policy | `config.ts`, `errors.ts`, `pricing.ts`, `cap.ts` + tests | ~190 | Low |
| 2 | Client + parsers | `client.ts` (injected `fetch`, required `reveal`), `parse.ts`, `revealState.ts`, fixtures + tests | ~290 | Low |
| 3 | Data model | Migration + `_rollback`, `lusha_reveal` in `schema.ts`, two comment vocabularies | ~120 | Low |
| 4 | Ledger + write path | `revealPlan.ts`, `revealDb.ts` (reserve / settle ×2 / fail / reject / 2 reads), duplicate-candidate write | ~350 | Med |
| 5 | Actions + registration | `lushaActions.ts` (4 actions), `actionErrors.ts` table, `es`/`en` copy, the activity type across ~8 files, README | ~230 | Low |
| 6 | UI | `page.tsx` wiring, the reveal control on both rows, search + reveal + reject dialogs, Lusha badges | ~360 | Med |

**Total ≈ 1,540 lines of production code across 6 PRs — a revision upward of the proposal's ~800-1,000 across 3.** The proposal priced a one-search-per-click flow with a single tombstone index. Hybrid caching made the search a first-class lifecycle with its own outcomes (~+150), the rejected-match decision added a retry path, a second state machine branch and a third dialog action (~+120), the cap race needed a real reservation transaction rather than a claim insert (~+80), and the duplicate decision added the candidate write and its copy (~+70). Chained PRs: **Yes**, `chain_strategy: stacked-to-main` — each PR merges to `main` in order, which is what this repo already does and what the inert-until-PR-6 slicing is built for: a slice that is unreachable by construction is safe on `main` the moment it is reviewed.

The proposal's three slices survive as boundaries — pure logic (1-2), server-only (3-5), UI (6) — they simply do not fit in three PRs at this budget. **PR 6 is the first PR a BD can reach.** PRs 1-4 export functions nothing imports; PR 5's server actions are only reachable once a client component imports them, which is PR 6 — until then Next.js never emits their action ids into any bundle. The `LUSHA_API_KEY`-removal kill switch covers all six regardless.

## Preconditions and open questions

- [ ] **A mockup of the reveal control and all three dialogs, approved before PR 6.** Project rule: mockups before UI code.
- [ ] **Re-check the migration number against `drizzle/` at implementation time** — `0044` today, `0043` if the outreach-sequences chain slips.
- [ ] **Who clears the duplicate queue.** D12 enqueues into an admin-only surface; if no admin works it, the warning is the only thing the BD gets.
- [ ] **Watch the first production phone reveal** and open the parser-correction PR from the stored payload if the shape differs (D17). Remaining pool: **38 of 40**.
- [x] Free-plan keys can call v3; a no-match costs 0; a search is 1 credit per 25 results; `canReveal` prices the reveal before spending (probe, `#560`).
- [x] Phone stays in the first slice; no 5-credit probe is bought, the first real reveal is the measurement, and `pickPhone` fails closed (owner, 2026-10-14 → D17).
- [x] `lusha_reveal` registers in `STATUS_NEUTRAL_ACTIVITY_TYPES` + `NO_PROGRESS_ACTIVITY_TYPES` only, **not** `NON_TOUCH_ACTIVITY_TYPES` — a reveal keeps counting as "última actividad" (owner, 2026-10-14 → D15).
- [x] Cap global-only, single configurable number, default 12 (`#557`); it counts every credit charged, including a search whose match was later rejected.
- [x] Duplicate revealed email warns and offers merge (`#557`).
- [x] A rejected match is recorded, is not permanent, and "buscar de nuevo" pays a new search credit (owner, 2026-10-14).
