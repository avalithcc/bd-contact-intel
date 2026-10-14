# Design: Outreach Sequences

**Decision in one line**: a Sequence is six new additive tables (`sequence`, `sequence_member`, `sequence_draft`, `sequence_send_claim`, plus company-wide `email_suppression` and `sequence_unsubscribe_token`) driven by a cron runner whose every decision — Miami-time due instants, the per-account daily cap, the pre-send checks, the auto-reply carve-out, the suppression match — is a pure function with a thin DB layer beside it. Nothing is sent that a BD did not approve, and nothing is released that the cap did not budget.

Specs: `specs/*/spec.md` (seven, all approved and authoritative). Mockups: `mockups/secuencia-detalle.html` and `mockups/baja-opciones.html` (owner chose Opción B — tracked link — on 2026-10-14). Design system and shell: inherited from `crm-hubspot-ux`, no new CSS classes.

## Quick path for reviewers

1. Read **Architecture decisions** (D1–D12). D1, D3, D5 and D9 are the ones the specs flagged as unresolved.
2. Read **The runner**, which is where the cap, the claim and the DST handling meet.
3. Check the **Review Workload Forecast**. It does not fit one PR; it drives the chain.

## Architecture decisions

| # | Topic | Choice | Rejected alternative | Why |
|---|---|---|---|---|
| D1 | Suppression storage | New **company-wide `email_suppression`** table (`kind`, `value`, no `bd_id`), consulted by the roster picker, the add action and the runner | Extending per-BD `email_never_log` (the owner's first suggestion) | `email_never_log` is per BD and means "never store this correspondent's mail". `classifyGmailMessage` applies it to the **whole message**: one matching participant in From/To/Cc and the entire message is discarded for every person (`isMessageNeverLogged`, classify.ts:125). Putting an opt-out there would (a) make that person's later replies invisible and break the reply detection `sequence-replies` depends on, (b) erase any thread where they are merely CC'd, including the BD's own sent copy, and (c) scope a CAN-SPAM opt-out to one BD when it binds the company. See **Suppression vs never-log** below. |
| D2 | Draft storage | `sequence_draft`, one row per **(member, step)**, carrying subject/body **and** that step's `reviewed_at`, `edited_at`, `approved_at`, `scheduled_for` | Four content columns on `sequence_member` (the mockup README's sketch) | Step 2 has its own content, its own review flag and its own independent approval (`sequence-approval`). One row per step keeps the member row to the state machine and its outcomes, and makes "edited → never auto-regenerated" a per-step fact instead of a pair of parallel nullable column sets. |
| D3 | Sending identity | Add `email_account.id uuid unique default gen_random_uuid()`, **keep `bd_id` as the primary key**, and point `sequence.email_account_id` at the new `id`. New entry point `sendGmailMessageFromAccount({ accountId, … })` | (a) FK on `email_account.bd_id`; (b) changing the PK to `id` | (a) is "send from whoever owns the Sequence" — the hardcoding the spec forbids, just spelled differently, and re-pointing becomes a schema change. (b) rewrites every `eq(emailAccount.bdId, …)` call site and every FK for no behaviour gained today. A UNIQUE column is a legal FK target in Postgres, so the reference works without touching the PK. **Named limitation** below. |
| D4 | Send path refactor | Extract the body of `sendGmailMessage` into `sendFromAccountRow(account, input)`. `sendGmailMessage({ bdId })` stays a thin wrapper that loads by `bdId`; the new entry point loads by `id` | A second copy of the send function for sequences | One token-refresh / error-classification / `recordSentEmail` path. Existing callers see no change. |
| D5 | Unsubscribe token | **Random 256-bit opaque token** (`randomBytes(32).toString("base64url")`), stored only as `sha256(token)` in `sequence_unsubscribe_token.token_hash` (unique), bound to one member + one normalized address | HMAC with an app secret; Vercel KMS signing | A suppression needs a DB row regardless (member link, `used_at` idempotency marker, provenance). Once the row exists a signature buys nothing and costs: an app-secret HMAC cannot be revoked per link, and rotating the secret invalidates every link already sitting in a recipient's inbox — directly breaking the 30-day validity requirement. KMS adds a network call to **every** verification, including every mail-scanner GET, and an external dependency on the one route that must work when the rest of the app is down. With a row, validity is "the row exists": 30+ days is satisfied with no clock in the verification path at all. Hashing at rest means a DB dump yields no working links. |
| D6 | GET vs POST | `GET /api/unsubscribe?t=…` **renders only**; only `POST` writes. The `POST` handler also accepts the RFC 8058 one-click body | A single acting GET | Corporate mail-security scanners and inbox prefetchers open every inbound URL. An acting GET would suppress recipients who never clicked, silently shrinking rosters and destroying the signal's meaning. Scanners do not POST. Gmail's native button does — via `List-Unsubscribe-Post`, which is the same POST semantics, so one-click and the confirmation page share one write path. |
| D7 | Cap enforcement | Pure `planSequenceRelease()` computes the release set **per sending account per Miami calendar day** from sends actually recorded; the runner sends only what the plan returns | A validated max on the Sequence form; a per-Sequence counter | The spec requires the refusal to live in the releasing code. Counting per account (not per Sequence) is what makes splitting work across two Sequences unable to bypass it; counting recorded `outcome='sent'` claims is what keeps failed attempts from consuming budget. |
| D8 | Miami time | New `src/lib/sequences/miamiTime.ts` using `Intl.DateTimeFormat(…, { timeZone: "America/New_York" })` | Extending `src/lib/tasks/argentinaDate.ts` | That module's governing assumption, stated in its own doc comment, is "fixed UTC-3, no DST, so a date can be read off an instant by shifting 3 hours". `America/New_York` violates it. Adding a DST-aware function there would make that comment false and invite someone to reuse the wrong boundary — the exact class of bug that file documents twice. The new file states the opposite assumption explicitly. Node 22 ships full ICU; no dependency. |
| D9 | Runner cadence | **Two fixed-UTC Vercel crons**, `0 13 * * *` and `0 14 * * *`, plus the runner's own pure `dueAt <= now` gate | (a) one cron at 14:00 UTC; (b) `pg_cron` hourly like the Gmail sync; (c) editing the cron expression twice a year | 09:00 Miami is 13:00 UTC under EDT and 14:00 UTC under EST. Under EDT the 13:00 run releases and the 14:00 run finds nothing new; under EST the 13:00 run is 08:00 Miami and correctly releases nothing, and the 14:00 run releases. A second run costs one planning query because at-most-once is already required (D10). (a) delays every send by an hour for the eight EDT months. (b) is precise but puts the scheduler outside the repo for a feature whose SLA is "same Miami calendar day", and the existing `scripts/gmail-sync-cron.sql` is already a manual owner-run step. (c) is a calendar reminder, not a design. |
| D10 | At-most-once | `sequence_send_claim` inserted with `ON CONFLICT DO NOTHING` **before** the Gmail call; the runner proceeds only if its own insert returned a row. Partial unique index on `(sequence_member_id, step) WHERE outcome <> 'failed'` | A `sending` state on the member; an advisory lock | Exactly the `task_digest_send` pattern already in this schema (schema.ts:1507). A `pending` claim with no recorded outcome is the crash case: never auto-resent, surfaced as `hold_reason = 'manual_check'`. A `failed` claim stays as history and the partial index lets a later run claim again, so a failure is retryable without a counter. |
| D11 | Auto-reply detection | **Extend `parseGmailMessage`** with `autoSubmitted`, `precedence`, `autoreplyHeaderPresent`; pure `isAutomaticMessage()` decides; result persisted as `email_message.is_automatic` | Subject heuristic only | Subject-only fails both ways: it misses every localized or custom out-of-office subject, and it false-positives the spec's own required case ("Re: senior engineers" / "I'm on vacation next week, call me after"). `Auto-Submitted` (RFC 3834) is the authoritative signal. The subject prefix list stays as the documented fallback for senders that omit headers, so both paths exist. The parse change is ~6 lines through the existing `findHeader`. Persisting it lets the transition be decided from stored rows rather than only in flight. |
| D12 | Naming | UI label and copy "Secuencia"/"Secuencias"; **routes `/sequences`, tables `sequence*`** | Spanish route segment `/secuencias` | The spec bans "Campaña"/"Campaign" from UI, routes and table names — it does not require Spanish identifiers, and the repo's routes and tables are uniformly English (`/contacts`, `/follow-ups`, `person`, `follow_up_queue_item`). English identifiers with Spanish UI copy honours both rules and the global language contract. |

## Suppression vs never-log

| | `email_never_log` (exists) | `email_suppression` (new) |
|---|---|---|
| Scope | Per BD (`bd_id` FK) | Company-wide, **no bd column** |
| Question it answers | "Do not store this correspondent's mail in my CRM" | "Never **send** Sequence email to this address" |
| Enforced by | `classifyGmailMessage` — discards the whole message | Roster picker, add action, runner pre-send check |
| Effect on reply detection | Hides the message for every person, both directions | **None** — no sync code path reads this table |

Reply detection therefore keeps working for a suppressed address: the opt-out confirmation reply, and any later genuine reply, still sync, still match, still appear on the Contact. The two tables share only `normalizeNeverLogValue` (one normalization rule, reused). The matchers and types stay distinct (`SuppressionRule` vs `NeverLogRule`, `isSuppressed` vs `isNeverLogged`) so a `SuppressionRule[]` can never be handed to the classifier by mistake.

## Data model

Three additive migrations, each with a `_rollback.sql` twin (the convention since `0028`). `npm run db:push` is **never** used: `schema.ts` declares no RLS, so push would leave the new tables open to `anon`. Each new table ends its migration with `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and **no policies** — the posture established in `0019_enable_rls.sql` and repeated in `0040`: the app connects as `postgres` (owner, BYPASSRLS) and never reads through PostgREST, so RLS-with-no-policies denies `anon` and `authenticated` outright. The unsubscribe route uses the same Drizzle/`postgres` client as everything else, never supabase-js, or RLS would block it.

| Migration | Contents |
|---|---|
| `0041_outreach_sequences` | `sequence`, `sequence_member`, `sequence_draft`, `sequence_send_claim`, and `email_account.id uuid unique not null default gen_random_uuid()` |
| `0042_email_suppression` | `email_suppression`, `sequence_unsubscribe_token` |
| `0044_email_message_is_automatic` | `email_message.is_automatic boolean not null default false` |

`ADD COLUMN id … DEFAULT gen_random_uuid()` is a **volatile** default, so Postgres rewrites the table and evaluates it per row — existing `email_account` rows get distinct ids, not one shared value. `NOT NULL` is added after the backfill in the same migration.

| Table | Key fields | Notes |
|---|---|---|
| `sequence` | id, name, `owner_bd_id`, `email_account_id` → `email_account(id)`, `daily_send_cap integer not null default 5`, `schedule jsonb not null`, created/updated at | No `is_active` column — "active" is derived (see the badge). `schedule` is `{ step1: { hour, timezone, offsetDays }, step2: { afterDays } }`, read through a pure `parseSchedule()` with the spec's values as fallback; same jsonb precedent as `saved_view.filters`. |
| `sequence_member` | id, sequence_id (cascade), person_id, `state`, sent_at, replied_at, reminder_due_at, discard_reason/by/at, `hold_reason`/`hold_at`, created_at | `unique(sequence_id, person_id)` is the "at most once per Sequence" rule in the DB. Indexes: `(sequence_id, state)`, `(person_id)`. `state` is free text validated at the write boundary — repo convention (`client_status`, `contact_type`), no CHECK. |
| `sequence_draft` | id, sequence_member_id (cascade), `step smallint`, subject, body, generated_at, edited_at/by, reviewed_at/by, approved_at/by, `scheduled_for` | `unique(sequence_member_id, step)`. `edited_at not null` is the "BD owns this text" marker that every batch job must skip. |
| `sequence_send_claim` | id, sequence_member_id, step, claimed_at, `outcome` (`pending`/`sent`/`failed`), `sending_account_id`, `miami_send_date date`, gmail_message_id, rfc_message_id, gmail_thread_id, error, sent_at | Partial unique `(sequence_member_id, step) WHERE outcome <> 'failed'` (D10). `miami_send_date` set only on `sent`; index `(sending_account_id, miami_send_date) WHERE outcome = 'sent'` backs the cap count in one indexed read. `rfc_message_id` is what the reminder threads against. |
| `email_suppression` | id, `kind` (`address`/`domain`), `value` (normalized), `source` (`unsubscribe_link`/`bd_action`/`import`), recorded_by_bd_id (null for the link), person_id, sequence_member_id, created_at | `unique(kind, value)` makes the POST idempotent with `ON CONFLICT DO NOTHING`. No `bd_id` — that is the point (D1). |
| `sequence_unsubscribe_token` | id, `token_hash` (unique), sequence_member_id, `email_normalized`, created_at, used_at | One row per member, created when the step 1 footer is built, reused by the reminder footer so a recipient sees one stable URL. |

## The runner

`/api/sequences/run` — `isValidBearer(authHeader, process.env.CRON_SECRET)`, fails closed on an unset secret, `dynamic = "force-dynamic"`, `maxDuration = 300`, registered twice in `vercel.json` (D9), added to the session-gate exemption list. Returns `{ released, held, deferred, failed }`.

```
cron 13:00 / 14:00 UTC
      │
      ▼
read candidates (approved drafts, dueAt <= now) + sentTodayCount per account
      │
      ▼
planSequenceRelease (PURE)  ── cap = min(caps of sequences with candidates)
      │                        budget = max(0, cap - sentToday)
      │                        order  = dueAt asc, approvedAt asc, id asc
      ├──► deferred[]  (over budget: stay `approved`, no hold written)
      ▼
per release candidate:
  evaluatePreSendChecks (PURE) ──► held[] (reason persisted on the member)
      │ ok
      ▼
  claim: INSERT … ON CONFLICT DO NOTHING ──► no row? skip (already claimed)
      │
      ▼
  sendGmailMessageFromAccount ──► email_sent activity + email_message row
      │                            (existing recordSentEmail path; status
      │                             follows deriveStatus, nothing new sets it)
      ├─ GmailSendError reauth_required|not_connected ──► halt this ACCOUNT
      ├─ GmailSendError temporary|send_failed         ──► this member only
      ▼
  claim.outcome='sent', miami_send_date; step 1 ──► reminderDueAt(sentAt)
                                        step 2 ──► member `no_reply`
```

`deferred` and `held` are deliberately different return channels: a cap deferral leaves the member `approved` with no hold reason (the spec forbids dropping or auto-cancelling it), while a failed check writes `hold_reason` so the card can show why.

**Pre-send checks** (pure, one function, one `HoldReason` union): member/draft still approved · Contact not merged and still has an email · `isSuppressed(address, rules)` false · company `client_status` null · `bodyHasFooter(body, config)` true · account `status = 'connected'` · for step 2 only: no genuine reply recorded **and** `isSyncFreshEnough` **and** a stored `rfc_message_id` exists for step 1 (otherwise hold `no_thread_headers` — never an unthreaded reminder).

**Sync freshness.** `isSyncFreshEnough({ lastSyncedAt, now, staleAfterMs })`; `null` → stale → hold. `SEQUENCE_SYNC_STALE_MS = 26h` (24h + the spec's 2h grace), one constant in `src/lib/sequences/config.ts`. The real cadence is `pg_cron` every 2 minutes, but the only cadence the repo itself guarantees is the daily Vercel safety net (`vercel.json`, `/api/gmail/sync` at `0 12 * * *`). Pinning the check to 2 minutes would hold almost every reminder whenever pg_cron is paused; pinning it to the guarantee holds only when the guarantee is actually missed. The constant carries a comment to drop it to `2min + 2h` if the daily net ever stops being the floor.

## Drafting, and the Spanish-default trap

**Finding**: `buildOutreachEmailPrompt` (`src/lib/outreach/emailPrompt.ts`), the function `sequence-drafting` names, has **no caller and no test** anywhere in the repo — it is dead code. The live generator is `buildOutreachMessagePrompt` (`messagePrompt.ts`) via `runGenerateOutreachMessage`, keyed on `channel: "email"` and `language: MessageLanguage`, whose default is `"es"` (`DEFAULT_MESSAGE_LANGUAGE`). Both default to Spanish when the language is not passed explicitly, which is the regression the spec is guarding against.

Decision: draft through the **live** path (`runGenerateOutreachMessage`, `channel: "email"`, `language: "en"`). That satisfies the spec's actual requirement — reuse the existing prompt and its ten defensive rules, do not fork them — better than reviving a dead function, and it inherits the email channel's JSON `{subject, body}` parsing (`parseEmailModelOutput`) that the Sequence needs anyway.

`"en"` is passed from exactly **one** place: `SEQUENCE_DRAFT_LANGUAGE: MessageLanguage = "en"` in `src/lib/sequences/draftInput.ts`, consumed only by `buildSequenceDraftInput()`, which is the only function the drafting action and the reminder job call. Two guards make a silent regression a build failure: a unit test asserting `buildSequenceDraftInput(...).language === "en"`, and an import-allowlist test in the exact style of `tests/unit/argentinaDayBoundariesUsage.test.ts` that fails if any file under `src/lib/sequences/` or the sequence routes calls `runGenerateOutreachMessage` without going through `buildSequenceDraftInput`.

Signals come from `extractOutreachSignals` over the **same** input object handed to the prompt, so the "Señales usadas" chips can never describe something the generator did not see. The compliance footer is appended by `buildFooter(config, unsubscribeUrl)` **after** generation, never asked of the model — `bodyHasFooter()` is the pure check the runner re-applies at send time, so a BD who edits it away gets a hold, not a violation. Address and opt-out text live in `src/lib/sequences/config.ts`; the absolute URL comes from the existing `resolveSiteUrl()` (`src/lib/config/siteUrl.ts`).

Per-member generation failure is isolated by design: the batch is a sequential loop with a per-member try/catch (never `Promise.all` — prod pool `max: 3`, PERFORMANCE.md), and a failure simply leaves no `sequence_draft` row.

## Unsubscribe route

`GET /api/unsubscribe?t=<token>` → `sha256` the token, one indexed lookup on `token_hash`, **zero writes**. Valid → the confirmation page from `baja-opciones.html` with a POST form. Unknown or malformed → the same generic "this link is no longer valid" page, revealing nothing and naming no address.

`POST` → one transaction: insert `email_suppression` (`ON CONFLICT (kind, value) DO NOTHING`), set `used_at` if null, and move every non-terminal membership for that address to `discarded` with reason `opt_out` and a null actor. Repeat POSTs render the same confirmation and change nothing. Re-admission of an `opt_out` discard is rejected by `canTransition`, not by the UI.

Headers on every Sequence message, both steps:

```
List-Unsubscribe: <https://{site}/api/unsubscribe?t={token}>, <mailto:{sender}?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

The https URI first satisfies RFC 8058 one-click (Gmail's native button POSTs `List-Unsubscribe=One-Click` as `application/x-www-form-urlencoded`, which the POST handler accepts without any form token or referer check). The `mailto:` alternative keeps the opt-out working in clients that do not do one-click and feeds the reply path, which stays required ("No contactar" + advisory phrase detection). `buildRawMessage` gains an `extraHeaders?: string[]` parameter spread into the envelope, each value through `assertSafeHeaderValue`.

Middleware: the `CRON_ROUTES` local in `src/lib/supabase/middleware.ts` is renamed `SESSION_EXEMPT_ROUTES` and gains `/api/unsubscribe` and `/api/sequences/run`, keeping the existing exact-match-or-slash-prefix rule so a future `/api/unsubscribe-admin` cannot slip through.

## Pure / DB split

The established pattern (`appShellBadgeCountsQuery.ts` pure, `appShellBadgeCounts.ts` thin DB layer). Everything in the left column imports no `@/db` and is unit-tested under `tests/unit/` with `npm run test:unit`.

| Pure module (`src/lib/sequences/`) | What it decides | DB layer |
|---|---|---|
| `miamiTime.ts` | `miamiCalendarDate`, `miamiWallClockToUtc`, `nextMiamiNineAm` | — |
| `schedule.ts` | `step1DueAt(approvedAt)`, `reminderDueAt(step1SentAt, approvedAt)` | — |
| `releasePlan.ts` | the cap, the order, release/defer/hold split | `releaseQueries.ts` |
| `preSendChecks.ts` | the seven re-checks → `HoldReason` | — |
| `memberState.ts` | `canTransition(from, to, trigger)` from `sequence-approval`'s table | `memberQueries.ts` |
| `rosterGuards.ts` | per-Contact accept/reject: reachable, 2-per-company, client, suppressed, duplicate | `rosterQuery.ts` (pure SQL builder) + `rosterQueries.ts` |
| `suppression.ts` | `isSuppressed`, `normalizeSuppressionValue` | `suppressionQueries.ts` |
| `autoReply.ts` | `isAutomaticMessage` | — |
| `complianceFooter.ts` | `buildFooter`, `bodyHasFooter` | — |
| `bulkApprovalGate.ts` | the "N de M revisados" gate, re-asserted server-side | — |
| `syncFreshness.ts` | `isSyncFreshEnough` | — |
| `draftInput.ts` | `buildSequenceDraftInput` (pins `"en"`) | `draftQueries.ts` |
| `stats.ts` | the four stat cards, the progress segments, the finished-state counts | — |
| `unsubscribeToken.ts` | `generateUnsubscribeToken`, `hashUnsubscribeToken` | `unsubscribeQueries.ts` |
| `capValidation.ts` | `validateDailySendCap` (1–15, warn above 8) | — |

**Reply handling** is a post-write hook in the existing sync, not a second matcher: `parseGmailMessage` → `classifyGmailMessage` (now carrying `isAutomatic`) → `email_message.is_automatic` → `applySequenceReplies(storedMessages)`, which moves a member `sent`/`no_reply` → `replied` only for a non-automatic inbound message from the member's Contact dated after the step 1 send, and withdraws any pending or approved reminder. It never writes `follow_up_queue_item`; the handoff happens through the existing `replied` due rule.

**Badge**: `buildAppShellBadgeCountsQuery` gains a sixth scalar subquery, `sequence_count` — the BD's sequences with at least one member outside `{replied, no_reply, discarded}` — so the shell still pays exactly one round trip for the whole sidebar.

## Routes

| Route | Change |
|---|---|
| `/sequences` | New owner-scoped list |
| `/sequences/new` | Create + roster picker |
| `/sequences/[id]` | The detail page from `secuencia-detalle.html` |
| `/api/sequences/run` | Cron runner, `CRON_SECRET`, session-gate exempt, 2 crons |
| `/api/unsubscribe` | Public GET (render) + POST (suppress), session-gate exempt |
| Sidebar | "Secuencias" entry directly below "Seguimientos", pill count |

## Testing strategy

| Layer | Target | Approach |
|---|---|---|
| Unit (strict TDD) | Every module in the left column above. Required cases: the spec's `2026-11-02 09:00 → 14:00 UTC` DST assertion and both 2026 transitions; cap with 8 approved / cap 5 / 0 sent; cap lowered mid-day below what is already sent; two Sequences one account; failed send not counted; `Auto-Submitted: auto-replied` vs "Out of Office:" subject vs the genuine "I'm on vacation next week, call me after"; `Jane@Acme.com` against `jane@acme.com`; domain rule; `bodyHasFooter` after the BD deletes the address; `"Re:"` on a step 1 subject; the bulk gate at 1-of-3 and 3-of-4; `buildSequenceDraftInput().language === "en"` plus the import allowlist | `node:test` via `npm run test:unit` |
| Integration | The claim under two concurrent runners; the POST idempotency; GET writing nothing | A seeded local DB and a script, not the unit suite |
| E2E | The detail page's six card states, the review dialog, the bulk gate, the sidebar badge | Playwright `npm run test:e2e`, 1280px only, acceptance after owner approval |

Playwright needs a real authenticated session, so it is acceptance only. It is explicitly **not** where any cap, cadence or suppression rule is verified — those live in the unit layer by construction.

## Migration / rollout

Additive only. Three migrations, three rollbacks, no backfill: every `sequence_member` is created by a BD after the feature ships, and the member transition only considers messages dated after a step 1 send, so `email_message.is_automatic` defaulting to `false` on historical rows is correct, not a gap. Rollback is the rollback SQL plus reverting the commit; nothing existing is rewritten. The `email_account.id` column is additive and unread by any existing code path.

## Named limitations and out-of-scope, stated on purpose

- **One account per BD remains.** `email_account`'s PK is still `bd_id` (D3), so `email_account_id` buys the reference — no hardcoded address, re-pointing is a data change — but a **second simultaneous** account for one BD (the dedicated sending subdomain the owner plans for) still needs the PK relaxed. The follow-up is additive: drop the PK, add `unique(bd_id) WHERE is_primary`. Doing it now would be speculative work against an unmade decision.
- **Out-of-office still marks the Contact `replied`.** `sequence-replies` requires this change not to alter how the existing sync writes `reply_received` and derives status. The consequence is real and the owner must accept it: a Contact can read `replied` on the record while the Sequence member correctly stays `sent`. `email_message.is_automatic` makes the later fix a one-line filter in `buildSyncedActivities.ts`, in its own change.
- **`emailPrompt.ts` is dead code.** Deleting it, or wiring it as the email generator, is a separate cleanup. Leaving an unused second email-prompt builder in the tree is how a future contributor reintroduces the Spanish default.
- ~~**CookUnity and Mercado Libre are unmarked clients.**~~ **Not true — measured against production 2026-10-14.** All eight public clients named in `AVALITH_PROFILE` carry a `client_status`: six are `inactive` (Mercado Libre, Accenture, CookUnity, GlobalLogic, Jampp, Ualá) and two are `active` (Global Hitss, MODO). None is unmarked, so the `client_status` exclusion works as specified and the send-time re-check has a non-empty column to read. No extra work is needed here. The owner confirmed on 2026-10-14 that an `inactive` client is a past client and MUST NOT receive cold outreach.
- **A sent link outlives a domain change.** The token row survives any route change, but the host baked into already-sent mail does not. Acceptable; noted.
- **Rate limiting on `/api/unsubscribe`** is not designed. The abuse ceiling is "suppress someone whose 256-bit token you already hold", and the write is idempotent, so the exposure is one suppression per leaked link.

## Review Workload Forecast

| PR | Slice | Content | Est. lines | 400 risk |
|---|---|---|---|---|
| 1 | A data model | Migration `0041` + rollback, `schema.ts` tables, `email_account.id` | ~300 | Med |
| 2 | B pure core | `miamiTime`, `schedule`, `memberState`, `capValidation` + tests | ~175 | Low |
| 3 | C compliance | Migration `0042` + rollback, `suppression`, `complianceFooter`, `config` | ~280 | Low |
| 4 | C public route | `/api/unsubscribe` GET+POST, token module, queries, both pages, middleware exemption | ~260 | Low |
| 5 | D roster | Picker SQL builder, `rosterGuards`, create/add/remove/re-admit actions | ~320 | Med |
| 6 | E drafting | `draftInput` (+ the two `"en"` guards), batch generate, regenerate, edit protection, footer wiring | ~300 | Med |
| 7 | E approval | Review tracking, single + bulk approve with the server-side gate, cancel | ~280 | Low |
| 8 | F send path | `sendFromAccountRow` extraction, `sendGmailMessageFromAccount`, `extraHeaders` in `buildRawMessage` | ~150 | Low |
| 9 | F runner | `/api/sequences/run`, `releasePlan`, `preSendChecks`, `syncFreshness`, `releaseQueries`, `vercel.json` | ~340 | Med |
| 10 | G replies | `parseMessage` headers, `autoReply`, `classify.isAutomatic`, migration `0044`, `applySequenceReplies` | ~280 | Low |
| 11 | H UI detail | Detail page, member cards (six states + hold reasons), stat cards, progress, empty + finished states | ~360 | Med |
| 12 | H UI dialogs | Review dialog, bulk bar, list page, sidebar entry + `sequence_count` subquery | ~340 | Med |

**Total ≈ 3,385 lines of code across 12 PRs. This does NOT fit one PR — it is 8.5× the 400-line budget. Chained PRs recommended: Yes. Decision needed before apply: Yes** (chain strategy). Tests and docs are excluded from these numbers per the owner's budget rule; the unit suite for slices B, C, F and G will be substantial on top.

Natural slice boundaries, in dependency order: **A** data model → **B** pure decision core → **C** compliance storage + public route → **D** roster → **E** drafting + approval → **F** send path + runner → **G** replies → **H** UI. A and B are independent of each other and can land in either order. C must precede E (the footer needs the token table). F must precede G (a reply needs a send to react to). H needs D–F to have anything to render, and is the only slice the owner can review visually against the approved mockup.

## Preconditions and open questions

- [ ] **The exact Mar del Plata postal address string.** It is not in the codebase and it blocks the footer config — therefore it blocks PR 3 and everything downstream. Nothing can be sent without it.
- [ ] **Counsel sign-off** on advertisement disclosure and subject-line accuracy for generated copy. This document gives no legal advice.
- [ ] **`AVALITH_PROFILE` claims Miami offices** (`messagePrompt.ts:55`), so generated drafts already tell US recipients so. Out of scope per `sequence-compliance`, but this feature sends those drafts automatically to US recipients — it needs an owner call before the first real send, not after.
- [ ] **Chain strategy** (`stacked-to-main` vs `feature-branch-chain`) for a 12-PR chain.
- [x] GET renders and POST suppresses (spec + `baja-opciones.html` Opción B).
- [x] Tracked link chosen over reply-only, with the reply path retained (owner, 2026-10-14).
- [x] Default cap 5, ceiling 15, warning above 8 (owner, 2026-10-14).
- [ ] Confirm `NEXT_PUBLIC_SITE_URL` is set in the production environment, or accept the `resolveSiteUrl()` fallback `https://bd-contact-intel.vercel.app` as the host baked into every unsubscribe link.
