# Proposal: Lusha Contact Reveal

## Intent

Outreach Sequences can only enroll a Contact that passes `isReachable` (`src/lib/sequences/rosterGuards.ts`): a non-empty email, `emailStatus != 'none'`, and `emailSource != 'pattern_inferred'`. Most of the base fails that gate, so email coverage — not contact volume, not startup classification — is what limits Sequences today. This change gives every BD a per-contact action on the Contact record to reveal that person's **email or phone through Lusha**, visibly branded as a Lusha action so the BD understands it spends real money, writing the result through a path that makes the Contact sequence-eligible.

**Target users**: BDs, on the Contact record, at the moment they want to work a person they cannot reach.

**Business driver**: every revealed email converts a dead Contact into a Sequence-eligible one. The constraint is cost: the company Lusha account is on the **free plan with 40 credits total**, so the feature's primary engineering concern is not the API call — it is never spending a credit twice and never letting a day of clicking empty the account.

## Current-State Gap

- A BD who finds a promising Contact with no email has no in-app path to get one. The only enrichment that exists (`hunter_lookup` activity, `emailSource = 'hunter_finder'`) came from offline file imports, not from a live per-contact action.
- `emailSource = 'pattern_inferred'` contacts look reachable to a human and are explicitly rejected by the roster guard, so Sequences silently skips them.
- Lusha is reachable today only through the owner's **personal OAuth MCP** (`https://mcp.lusha.com`, local Claude Code scope). The application has no Lusha integration at all: the single repo reference is the `LUSHA_` prefix in `shellLeakKeys` (`src/lib/dev/localDevEnv.ts:47`) and the README line "Lusha is production-only: do not add a key locally" (`README.md:29`).
- There is no credit accounting anywhere, so there is no way to answer "how much have we spent, and on whom".

## Scope

### In Scope

1. **Per-contact reveal action** on the Contact record for two fields: **email** and **phone**, one contact at a time, each behind its own confirm-before-spend dialog showing that field's credit cost.
2. **`lusha_reveal` ledger table**: the cache, the audit trail, and the source of truth for the daily caps — including rows for the **no-match** case.
3. **Dedicated write path** for a revealed value (not the manual property-edit path), so a revealed email lands sequence-eligible.
4. **Credit-denominated daily caps**, enforced server-side from the ledger.
5. **Production-only gate**: a single `getLushaConfig()` that fails closed unless `VERCEL_ENV === 'production'` and the API key is present.
6. **Reveal activity** recording the actor BD, registered everywhere existing activity types are registered, and status-neutral.
7. **Lusha branding** on the action button and on the revealed value.
8. **A live probe of the free-plan API key as the first task**, before any feature code (see Open Question Q2).

### Out of Scope (non-goals)

- **No bulk reveal and no multi-id enrich.** No list-level action, no "reveal all in this view", no `ids[]` with more than one entry. One contact, one field, one confirmation.
- **No company enrichment** (`revealCompany`, `/v3/companies/*`).
- **No prospecting search** — no net-new people from Lusha, no `prospecting_contact_search`. This feature only enriches Contacts the CRM already has.
- **No Lusha calls from local development, preview deploys, or scripts.** Local dev never holds a key and never reaches the network.
- **No use of the Lusha MCP by the application**, ever. It is the owner's personal OAuth; the app uses a server-side REST key.
- **No automatic or scheduled reveal**, no cron enrichment, no reveal on contact creation or on import.
- **No mobile work** (desktop-only CRM).
- **No waterfall async job polling.** The reveal is a synchronous request/response inside one server action; if the API returns an async `job`, the attempt fails cleanly rather than growing a polling subsystem.

## Business Rules (settled)

These were decided by the owner on 2026-10-14 (engram `#547`, `#553`) and are not reopened here. The rationale is recorded because the spec and design phases must preserve it.

| # | Rule | Rationale |
|---|------|-----------|
| R1 | A revealed email is stored with **`emailStatus = 'probable'`** and **`emailSource = 'lusha'`**. Not `verified`, not a new status value. | Lusha does not verify deliverability, so `verified` would be a lie that the suppression and bounce logic trusts. `probable` is already in the existing vocabulary (`'verified' \| 'probable' \| 'none'`, `src/db/schema.ts:718`) and already passes `isReachable`. **Verified while writing this proposal**: both columns are free-text (`text`, no DB enum), so neither value needs a migration, and `isReachable` accepts `probable` + `lusha` exactly as required. |
| R2 | The cache is a new **`lusha_reveal` ledger table** — person, field, revealed value, actor BD, credits charged, outcome, timestamp — **including the no-match case**. | Columns on `person` cannot record "we paid and Lusha had nothing", so without the ledger the same unknown contact is re-queried and re-charged forever. The ledger is simultaneously the never-pay-twice cache, the cap counter, and the spend audit trail. |
| R3 | The first slice covers **email AND phone**, with a **separate confirmation for phone** (5 credits vs 1). | Owner override of the email-only recommendation: a phone is worth 5x an email to a BD, so it should not wait for a second change. The separate dialog exists because the cost difference must be a conscious decision, not a muscle-memory click. |
| R4 | The daily cap is counted **in credits, not in reveals**: **15 credits/day globally** and **5 credits/day per BD**, read from the ledger's `creditsCharged`. | A reveal-denominated cap is unsafe when reveals have different prices: "10 reveals/day" allows 50+ credits/day against a 40-credit lifetime pool. Counting the amount actually billed by the API is the only denomination that bounds spend. **See the Credit Math section — the 5-credit per-BD figure has an arithmetic conflict with R3 that the owner must settle (Q3).** |
| R5 | The production gate is **`VERCEL_ENV === 'production'` AND the API key present**, resolved in one `getLushaConfig()` that mirrors `src/lib/gmail/config.ts`: fails closed, reports missing variable names only, never values. | `NODE_ENV` is **not** a usable discriminator: Vercel preview deploys also run with `NODE_ENV=production`, so a `NODE_ENV` gate would let every preview branch spend real credits. The existing `src/lib/dev/localDevGuard.ts` / `src/instrumentation.ts` guards only cover `NODE_ENV=development`, so they do not cover this case. |
| R6 | **Server-side REST only**, authenticated with an API-key environment variable. The Lusha MCP must never be called by the app. | The MCP is the owner's personal OAuth session in Claude Code; it cannot authenticate application traffic, and binding product behavior to one person's session is not a deployable integration. |
| R7 | Every reveal writes an **activity recording the actor BD** (owner's standing rule), under a new activity type registered in every place the existing types are registered — including **`STATUS_NEUTRAL_ACTIVITY_TYPES`** (`src/lib/status/deriveStatus.ts:117`) — so a reveal never moves the Contact's stage. | Buying a data point is not relationship progress. Without the status-neutral registration, a reveal could advance a Contact out of `new` and corrupt the derived pipeline, which R4 of `crm-hubspot-ux` defines as activity-derived and never hand-edited. |
| R8 | The reveal uses its **own write path**, not `updateContactProperty`. | See the Blocker section: the manual path writes `emailStatus = 'none'` / `emailSource = 'manual'`, which is precisely what the roster guard rejects. |
| R9 | **Always send an explicit `reveal` selection** on the Lusha v3 request. | Omitting `reveal` on v3 returns **both** email and phone, so a 1-credit email action silently becomes a 6-credit charge. This is a correctness rule, not an optimization. |
| R10 | **Check the ledger before calling Lusha.** Never pay twice for a value already revealed, and never re-query a known no-match. | The ledger is worthless as a cache if the call path can bypass it. |
| R11 | A **server-side in-flight guard** prevents a double click from becoming a double charge. | The confirm dialog is client-side only; two fast clicks are two server actions. Spend protection that lives in the browser is not spend protection. |

## The blocker this change has to solve

Writing a revealed email through the existing manual property path (`updateContactProperty` → `planPropertyEdit`, `src/lib/contacts/propertyEdit.ts` + `propertyEditDb.ts`) sets `emailStatus = 'none'` and `emailSource = 'manual'`. `isReachable` rejects exactly that:

```ts
// src/lib/sequences/rosterGuards.ts:35
export function isReachable(c: RosterCandidate): boolean {
  return !c.mergedIntoId && !!c.email?.trim() && c.emailStatus !== "none" && c.emailSource !== "pattern_inferred";
}
```

So a reveal written through the manual path would spend credits and still leave the Contact unable to enter a Sequence — defeating the entire business driver. The reveal therefore needs its own write path that sets `email`, `emailNormalized`, `emailStatus = 'probable'`, `emailSource = 'lusha'`, `emailConfidence` (Lusha returns a confidence per email), and a `person_property_history` row with a new `source` value. **Verified**: `person_property_history.source` is free text with a documented vocabulary in a schema comment (`src/db/schema.ts:858-865`, which already includes script-driven values like `signature_extract`), so a `lusha_reveal` source needs no migration — only the comment extended.

## Credit Math and the cap

Confirmed live from `GET /v3/account/usage` with the owner's account (a free call): plan category `free`, **40 credits total, 0 used**, rate limits 100 requests/day and 40/minute, and this pricing map:

| Action | Credits | Note |
|--------|---------|------|
| `contactSearch` | 1 per 25 results | A documented example billed 1 credit for 3 results, so a single-contact search costs 1. |
| `revealEmail` | 1 | |
| `revealPhone` | 5 | |
| `revealCompany` | 1 | Out of scope. |

**Found while writing this proposal — a reveal is not one charge, it is two.** `/v3/contacts/enrich` takes Lusha contact `ids`, which only a `contacts/search` (or `search-and-enrich`) produces. The CRM holds a LinkedIn URL or a name plus company domain, never a Lusha id. So the realistic per-action cost is:

| BD action | Billed | Effective cost |
|-----------|--------|----------------|
| Reveal email | 1 search + 1 email | **~2 credits** |
| Reveal phone | 1 search + 5 phone | **~6 credits** |

Consequences the owner should see plainly:

- The 40-credit pool is about **20 email reveals, or 6 phone reveals, for the lifetime of the free plan** — not 40 and 8.
- The 15-credit global daily cap is about **7 email reveals or 2 phone reveals per day**. Three capped days exhaust the free plan. The free plan is a pilot that proves the feature works, not a capability the team can lean on.
- **The 5-credit per-BD daily cap makes phone reveal unreachable.** At ~6 credits a phone reveal exceeds the per-BD daily budget outright, and even at the nominal 5 it consumes a BD's entire day. R3 (phone in the first slice) and R4 (5 credits per BD) cannot both hold as written — see Q3.
- The cap must therefore be fed by the **`billing.creditsCharged` the API actually reports** (which covers both charges), never by a hardcoded local price table. R4 already specifies this; it matters more than it looks.

## Capabilities

### New Capabilities

- `lusha-reveal`: the reveal action and its confirm-before-spend contract, the ledger as cache/cap/audit, the credit cap rules, the production-only gate, typed Lusha error handling, and the reveal activity.

### Modified Capabilities

- `sequence-roster`: no rule change, but revealed contacts become a new, intended inflow into roster eligibility. The guard itself stays untouched.
- `contact-record`: a new per-property action and badge on the About pane.
- `contact-identity`: a revealed email is a new write source for `person.email`, which is what makes the duplicate question (Q1) real.

## Approach

**One server action per reveal, ledger-first, fail-closed.**

1. **Probe before building** (first task, see Q2). With the server key in Vercel production: `GET /v3/account/usage` (free, confirms the key and the plan), then one `POST /v3/contacts/search` for a known person (1 credit, returns `canReveal` and proves v3 access **without** paying a reveal charge), then one `enrich` with `reveal: ["emails"]` (1 credit). A 403 on step 2 means the free plan cannot use v3 and the whole change stops for ~1-2 credits instead of after a week of work. A deliberate unknown-person search then answers the no-match charging question, reading per-contact `isCreditCharged`. Probe budget: **4 of 40 credits**.
2. **`getLushaConfig()`** (`src/lib/lusha/config.ts`) mirroring `src/lib/gmail/config.ts`: returns `{ ok: false, missing: [...] }` or `{ ok: false, reason: 'not_production' }` instead of throwing, so the UI can render a disabled state with a real explanation and no request is ever built with an `undefined` key.
3. **Ledger-first claim as both the cache and the in-flight guard.** The repo already has the right primitive: `onConflictDoNothing().returning()` used as an atomic claim (`src/lib/sequences/draftQueries.ts:127` returns `"skipped"` when the insert returns no row). A unique constraint on (person, field) plus a claim insert gives R10 and R11 in **one** mechanism: if the claim insert returns nothing, either the value is already paid for (serve from the ledger) or another request is in flight (reject as busy). No advisory locks, no new concurrency pattern. The ledger row carries an outcome state so a transient failure can release the claim while a `no_match` keeps it forever (see Edge Cases).
4. **Typed, non-retrying error mapping** (`src/lib/lusha/errors.ts`), following the `GatewayError` precedent in `src/lib/ai/generateMessage.ts` where distinct HTTP codes map to distinct `errorKey`s: `401` bad key, `402` no credits, `403` plan/v3 access, `429` rate limit, `451` GDPR block, plus the per-contact outcomes Lusha returns inside an HTTP 200 (`NOT_FOUND`, `COMPLIANCE_RESTRICTED`, `ENRICH_FAILED`). **Nothing retries automatically** — a retry on a paid endpoint is a second charge. Each key gets copy in the existing `es`/`en` dictionaries (`src/lib/contacts/labels.ts`, `actionErrors.ts`).
5. **Server action** in `src/app/(app)/contacts/actions.ts` following the established shape: `"use server"`, `getCurrentBd`, `assertContactEditableById`, typed `{ ok, reason }` via `actionFailure` + `unstable_rethrow`, `revalidatePath`. Order inside the action: config gate → ledger check → cap check → claim → Lusha call → write path + activity + ledger settle in one transaction.
6. **UI** following the existing quick-action dialog pattern (`src/app/(app)/contacts/[id]/QuickActions.tsx`: `Dialog`, `settleAction`, toast). The reveal control lives on the email and phone rows of `PropertyList.tsx`, with a Lusha badge on the button and a second Lusha badge on the revealed value so the cost stays legible after the fact.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `drizzle/0043_lusha_reveal.sql` + `_rollback.sql` | New | `lusha_reveal` table, unique (person, field), cap-supporting indexes. Follows the repo's numbered-migration-with-rollback-twin convention. |
| `src/db/schema.ts` | Modified | `lusha_reveal` table; extend the `person_property_history.source` comment vocabulary. |
| `src/lib/lusha/*` | New | `config.ts`, `client.ts` (REST, explicit `reveal`, rate-limit headers), `errors.ts`, `cap.ts` (pure credit math), `revealDb.ts` (claim, cache read, write path, activity, transaction). |
| `src/app/(app)/contacts/actions.ts`, `actionErrors.ts`, `src/lib/contacts/labels.ts` | Modified | Reveal server action and its error copy (`es`/`en`). |
| `src/app/(app)/contacts/[id]/PropertyList.tsx`, `AboutPane.tsx`, `src/components/PhoneValue.tsx` | Modified | Reveal buttons, Lusha badges, confirm dialogs (email and phone variants). |
| `src/lib/status/deriveStatus.ts` | Modified | New type added to `STATUS_NEUTRAL_ACTIVITY_TYPES`. |
| `src/lib/activity/queries.ts`, `timelinePills.ts`, `src/lib/contacts/timelineEntryBody.ts`, `lastActivity.ts`, `src/app/(app)/contacts/[id]/Timeline.tsx` | Modified | Register the new activity type: timeline visibility, the "Sistema" pill group (where `hunter_lookup` already sits), entry body, list-cell label, icon/filter maps. |
| `src/lib/activity/noProgressActivity.ts` | Modified (proposed) | See Q4 — ownership and follow-up-clock semantics. |
| `README.md` | Modified | Document `LUSHA_API_KEY` as production-only alongside the existing warning. |

## Implications and Impact

- **Sequences get a new inflow.** Revealed contacts start passing `isReachable`, so roster sizes grow for reasons unrelated to the roster code. That is the point, but it means the Sequences compliance and suppression paths now see addresses that no human typed and nobody verified.
- **Deliverability risk moves downstream.** `probable` is honest about Lusha not verifying, but a Sequence will still send to it. Bounce rate on revealed addresses is a number the team should watch on the sender reputation of the Gmail accounts, because a bad batch of revealed emails damages a shared asset.
- **Spend becomes a product surface.** Once BDs can spend money by clicking, "how many credits are left" becomes a question they will ask. This slice does not build a usage dashboard; the ledger makes one possible later, and the cap keeps the question from becoming urgent.
- **GDPR framing is now the team's problem, not Lusha's.** A `451` response and a `COMPLIANCE_RESTRICTED` outcome mean a person is protected from this kind of lookup. Those must read as "this person cannot be revealed", never as a transient failure a BD retries.
- **Local review is unaffected by design.** The production gate means the owner's local review flow never exercises the real integration, so the only place the feature is truly tested is production. That is an accepted tradeoff of R5, and it raises the value of a tight error surface.

## Edge Cases

- **Known no-match.** The ledger holds a `no_match` row; the button must render as "Lusha has no email for this contact" and must not be clickable again. A second click on a known no-match is a pure waste of a credit.
- **Transient failure after the claim.** A `429` or `5xx` arrives after the claim row exists. The claim must be released (or marked retryable) or the contact becomes permanently unrevealable; a `no_match` must do the opposite and persist. This is the one place where the claim-as-cache mechanism needs care.
- **Cap boundary.** A BD with 4 of 5 credits left requests a phone. The cap check must reject **before** the call, using the action's expected cost, not discover the overspend afterwards.
- **Day boundary.** "Per day" needs an explicit timezone — the app's existing business timezone (the one the follow-up queue and task digest already use), not UTC and not Lusha's own `resetsAt`, which tracks request limits rather than credits.
- **Phone has no provenance columns.** `person` has `phone` and `mobilePhone` (both free text, both editable, digits-expression indexed) but no `phoneStatus`/`phoneSource`. So the ledger is the **only** record that a phone came from Lusha, and the design must pick which column a revealed phone fills and what happens when it is already populated.
- **Existing value present.** The Contact already has a `pattern_inferred` email and the BD reveals a different one. Overwrite, or keep both? The reveal is strictly better provenance, but it is still a destructive write to a field another BD may have been using.
- **Revealed email already belongs to another Contact.** See Q1 — this is the one that can silently corrupt the base.
- **Merged contact.** A reveal on a Contact that was merged away (`mergedIntoId` set) should resolve to the surviving Contact or be refused, never write to a tombstone.
- **Lusha returns multiple emails or phones.** The response is an array with types and confidence. Picking silently is a product decision; the design should state the selection rule rather than taking element zero.
- **Credits exhausted account-wide** (`402`). Every reveal button in the app is effectively dead. The copy should say the account is out of credits, not "something went wrong".

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free plan cannot use v3 at all, invalidating the whole approach | Med | Q2's probe is the **first task**, costs ~2 credits, and fails the plan before any feature code exists |
| Accidental 6-credit charge from an omitted `reveal` selection | Med | R9: the client always sends an explicit selection; the design should make it a required parameter, not a default |
| Double charge from a double click | High without a guard | R11 server-side claim via `onConflictDoNothing().returning()`, the pattern already proven in `draftQueries.ts` |
| Whole 40-credit pool emptied in a day | High without caps | R4 credit-denominated caps enforced server-side from the ledger before every call; caps are the feature's main safety mechanism, not a nicety |
| Silent duplicate Contact from a revealed email | Med | **Unmitigated — Q1.** No unique constraint on `person.email` and no write-time duplicate check exist today |
| Paying twice for the same contact | Med | R2 + R10 ledger-first, including no-match rows |
| A preview deploy spends production credits | Med | R5 gates on `VERCEL_ENV === 'production'`, not `NODE_ENV` |
| Reveal advances a Contact's pipeline stage | Low | R7 registers the type in `STATUS_NEUTRAL_ACTIVITY_TYPES` |
| Reveal transfers ownership or resets the follow-up clock | Med | **Q4** — the `hunter_lookup` precedent does the wrong thing here |
| Bounces on revealed `probable` emails damage sender reputation | Med | Out of scope for this change; `probable` keeps the data honest so a future bounce policy can act on it |
| Exceeds the 400-line PR budget | High | Chained PRs — see Delivery |

## Rollback Plan

The change is additive. Rollback, in order of severity:

1. **Disable without deploying**: remove `LUSHA_API_KEY` from Vercel production. `getLushaConfig()` fails closed, the buttons render disabled, nothing else in the app changes. This is the real kill switch.
2. **Revert the UI slice**: the reveal buttons disappear; already-revealed values stay on the Contacts (they are ordinary `person` columns now) and the ledger stays as the spend record.
3. **Revert the data slice**: `drizzle/0043_lusha_reveal_rollback.sql` drops the table. Revealed values already written to `person` are **not** reverted — they are real data the team paid for, and the property history keeps their provenance.
4. Credits already spent are unrecoverable. This is why the probe comes first.

## Dependencies

- A **Lusha API key provisioned in Vercel production only** (`LUSHA_API_KEY`), never in `.env.local`, never in preview.
- **Q2's probe result.** Everything after task 1 is conditional on the free plan accepting v3.
- **Owner decisions on Q1 and Q3** before the data and UI slices respectively. Q3 blocks phone reveal specifically; email reveal can proceed without it.
- The uncommitted local-dev-stack work in the working tree (`scripts/dev-*`, `src/lib/dev/`, `src/instrumentation.ts`) should be committed or set aside first, since R5's gate touches the same gating story.

## Delivery and Review Workload

`delivery_strategy`: **ask-on-risk**.

Honest estimate of **production code** (tests and docs excluded per the project's budget rule):

| Slice | Content | Est. code lines |
|-------|---------|-----------------|
| 0 | Live probe (throwaway script, not merged) | ~0-30 |
| 1 | `getLushaConfig`, REST client, typed errors, pure cap math — no DB, no UI, fully unit-testable | ~250-300 |
| 2 | Migration + schema, ledger claim/cache, reveal write path, activity type registered across ~6 files, server action + error copy | ~350-400 |
| 3 | UI: reveal buttons, Lusha badges, email and phone confirm dialogs, disabled/no-match/out-of-credits states | ~200-250 |

**Total ~800-1,000 lines of production code.**

**Chained PRs recommended: Yes.** 400-line budget risk: **High**. Decision needed before apply: **Yes**. A single PR would be 2-2.5x the budget and would mix a paid external integration, a schema change, a cross-cutting activity-type registration, and UI — four different review mindsets. The slicing above is natural rather than arbitrary: slice 1 has no database and no UI, so it is reviewable as pure logic; slice 2 is server-only and shippable dark behind the absent key; slice 3 is the only slice a BD can see. Each slice is independently revertible, and the key-removal kill switch covers all of them.

## Success Criteria

- [ ] The probe result is recorded before any feature code is written, and the plan stops if the free plan rejects v3.
- [ ] A revealed email leaves the Contact with `emailStatus = 'probable'`, `emailSource = 'lusha'`, and `isReachable` returning true — demonstrated against the real guard, not asserted.
- [ ] No Lusha request is ever sent without an explicit reveal selection.
- [ ] A second reveal of the same person and field never reaches the network, including after a no-match.
- [ ] Two concurrent requests for the same person and field produce at most one charge.
- [ ] A reveal that would exceed the global or per-BD credit cap is refused before the network call.
- [ ] Credit totals in the ledger match Lusha's own `used` figure from `GET /v3/account/usage`.
- [ ] No reveal changes a Contact's derived status.
- [ ] Every reveal has an activity row naming the actor BD.
- [ ] With no key present, or outside `VERCEL_ENV = 'production'`, no Lusha request is constructed and the UI explains why.
- [ ] `401`, `402`, `403`, `429`, `451`, `NOT_FOUND`, `COMPLIANCE_RESTRICTED` and `ENRICH_FAILED` each produce distinct BD-facing copy, and none of them auto-retries.

## Open Questions

### Q1 — Duplicate email (owner decision required before slice 2)

A revealed email may already belong to a different Contact. **Verified**: `person` has **no unique constraint** on `email` (only the non-unique `person_email_normalized_idx`), and the write path performs **no duplicate check** — the identity matcher runs only on ingest and migration (`src/lib/identity/resolveDb.ts`), not on a property write. So today this would create a silent duplicate that nobody is told about.

| Option | Consequence |
|--------|-------------|
| **Block** the write when the normalized email exists on another Contact | No duplicates ever. The BD paid a credit and gets nothing written — the worst possible moment to show a wall. Needs copy that at least names the other Contact. |
| **Warn and link to the existing duplicate-review/merge flow** | The spend produces something useful: the BD learns these two records are the same person and can act. Matches HubSpot, which refuses to create a second contact on an existing email and sends you to the existing record. Costs a cross-feature touch into the review queue in this slice. |
| **Write anyway** | Cheapest to build, and the duplicate surfaces later in review. Also the only option that can corrupt the base silently, and it degrades Sequences directly: two Contacts with the same address means the same human can be enrolled twice. |

**HubSpot is the project's stated UX reference**, and it does not allow a silent duplicate email. Recommendation is therefore the middle option, but the owner decides.

### Q2 — Can a FREE-plan API key use the v3 endpoints, and is a no-match charged? (blocks everything)

Unresolved and unresolvable from documentation. The "Unified Credits" `403` documented for reveal parameters belongs to **v2** (`revealEmails`/`revealPhones` booleans); **v3** uses a `reveal` array and its own `403` means "account inactive or V3 access not enabled". These are different failures and the docs do not say which one a free key gets. No-match charging is likewise only inferred — a single `EMPTY_DATA` example shows `isCreditCharged: false`.

Only a live probe with the **server** key in Vercel production settles it. **This is task 1 of the change**, costs ~2 credits of 40, and must gate all further work so the plan fails fast and cheap. Note the owner's MCP session cannot answer this: it is a different authentication path and therefore not evidence about the API key.

### Q3 — The per-BD cap makes phone reveal impossible (owner decision required before phone ships)

Arithmetic conflict found while writing this proposal, not a reopening of R3 or R4. A phone reveal costs ~6 credits (1 search + 5 phone) against a **5-credit per-BD daily cap**, so no BD could ever complete one — and even ignoring the search charge it consumes a BD's entire day. Minimal resolutions, for the owner to pick:

- raise the per-BD cap (6-8 credits) so a phone reveal fits;
- or give phone its own small allowance separate from the credit cap;
- or exclude the search charge from cap accounting (understates real spend, and the global 15-credit cap would then also under-count);
- or ship email in the first slice and phone immediately after, once the real billed amount is known from the probe.

The probe's `billing.creditsCharged` gives the true number and should inform the choice.

### Q4 — Does a reveal count as a touch, for ownership and the follow-up clock? (recommendation, needs confirmation)

R7 settles the **status** question. It does not settle three other semantic lists an activity type participates in, and the existing precedents disagree with each other:

| List | `call_attempt` | `hunter_lookup` | Proposed for a reveal |
|------|----------------|-----------------|-----------------------|
| `STATUS_NEUTRAL_ACTIVITY_TYPES` | in | not in (relies on no `deriveStatus` case) | **in** (settled, R7) |
| `NON_TOUCH_ACTIVITY_TYPES` (counts as "última actividad") | not in | not in | **not in** — it is visible work, worth showing |
| `NO_PROGRESS_ACTIVITY_TYPES` (ownership + follow-up clock) | in | **not in** | **in** — recommended |

Following the `hunter_lookup` precedent, a reveal would **count for ownership** (so buying an email could transfer a Contact away from the BD who built the relationship, at the next merge or backfill) and **reset the follow-up clock** (buying 7 days of silence on a Contact nobody has messaged). Both are the silent-loss failure that `src/lib/activity/noProgressActivity.ts:15-22` documents as the reason `call_attempt` was excluded. A reveal is data acquisition, not relationship work, so the `call_attempt` treatment fits better than the `hunter_lookup` one. Confirm before slice 2, since it is a one-line registration either way but very hard to notice later.
