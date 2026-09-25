# Design: CRM HubSpot UX and Unified Contact

**Decision in one line**: add a new `person` table (UI name "Contact") next to the legacy `contact` and `lead` tables. A pure identity matcher fills it through a dry-run-gated migration. Status is a cached value derived from activity. The UI is built record-first on one shared app shell.

Proposal: `proposal.md` (authoritative). Mockups: `mockups/index.html`. No UI code ships until the owner approves the mockups (R9).

## Quick path for reviewers

1. Read **Architecture decisions** (table below).
2. Open `mockups/index.html` and click through contacts → record → duplicates → dry run.
3. Check the **Review Workload Forecast** at the end. It drives the PR chain.

## Architecture decisions

| # | Topic | Choice | Rejected alternative | Why |
|---|---|---|---|---|
| D1 | Unified model | New `person` table, with legacy `contact`/`lead` left read-only | Mutating `contact` in place (drop `bd_id`, add lead columns) | Additive rollback (proposal Rollback Plan). The 20k-row collapse is reversible by deleting the rows of one migration run. The name `person` avoids clashing with the existing `contact` TS export. |
| D2 | Per-BD data | `person_bd_connection` (personId, bdId, connectedOn, message aggregates) | `connectedOn` as a jsonb array on `person` | R7 keeps `connectedOn` per BD. Message aggregates are per BD, and the owner rule (R3) needs the earliest connection. |
| D3 | Identity | Pure `src/lib/identity/matcher.ts` over an `IdentityIndex` interface | Matching written inline inside the migration SQL | The migration dry run (in-memory index), CSV import and future scraping ingestion (DB index) share one tested rule set. |
| D4 | Status | `person.status` is a **cache**, recomputed by pure `deriveStatus()` in the same transaction as every activity write, merge or message import | A status column edited by the UI, or computed on each read | R4: never edited directly. The list and board need an indexed column for filters and counts. The cache also stores the id of the activity that set the status, which feeds the "why" hint. |
| D5 | Roles | `bd.role text not null default 'bd'` (`bd`/`admin`), plus `requireAdmin()` guard | Separate roles table / Supabase claims | There are two roles. `getCurrentBd()` already loads the `bd` row. |
| D6 | Audit | **Two structures, written in one transaction**: `merge_event` (property-loss trail plus restore snapshot) and `audit_log` (who did what, and when, for every admin action). Each merge or unmerge writes one row to each table, linked by `audit_log.metadata.mergeEventId`. | One `audit_log` that carries the snapshots | The tables answer different questions. `merge_event` is *data*: large jsonb, mutable `undone_at`, and it is what unmerge replays (duplicate-review, contact-identity R7). `audit_log` is *accountability*: small, append-only, and one uniform query ("what did admins do?") covering conversation views, merges, unmerges, not-a-duplicate decisions and migration approvals. This satisfies admin-access-audit's "Merges are audit-logged" (spec: "distinct from or alongside the merge trail"). |
| D7 | Saved views | System views are code constants (`src/lib/contacts/views.ts`). BD-created views go in the `saved_view` table (filters/columns/sort as jsonb). | All views in the DB | The views that replace outreach and hiring must be version-controlled and testable. The table only holds personal additions. |
| D8 | Redirects | `/leads/[id]` and `/contact/[id]` pages call `redirect()` after a `person_id_map` lookup | `next.config` redirects | The target id needs a DB lookup. |
| D9 | Components | `RecordShell`/`IndexShell` live under `src/app/contacts/` and are extracted to `src/components/` only when Company adopts them (later change) | Shared primitives built first | Follows the "extract, don't predict" rule from the exploration. Only the app shell (`Sidebar`, `TopBar`) is shared now, because every page already uses it. |
| D10 | i18n in client components | Spanish only (owner decision, R11): a single `es` dictionary, no `LocaleSwitcher`, no `en` dictionary usage path in the UI. Server components resolve dictionary functions from `es`. Client components receive a `ClientStrings` type that only allows plain strings. The dictionary keeps its existing `{ en, es }` structure (`src/lib/i18n/dictionaries/`) so English can be re-added later at low cost, but nothing in the app imports `en` or renders a switcher. `mockups/GLOSSARY.md` is the source of truth for Spanish terms and must be followed when new screens add dictionary entries. | Passing dictionary slices directly; keeping the `LocaleSwitcher` and dual-locale UI path | Dictionary functions passed to client components caused two production crashes. The type plus a unit test that walks the slices make that mistake a compile or test failure. The owner decided the product ships Spanish-only for now — the switcher and `en` usage path are removed from the UI as part of this change's shell PR, without deleting the dictionary structure itself. |

## Data model (migration `drizzle/0013_unified_person.sql`, additive)

| Table / column | Key fields | Notes |
|---|---|---|
| `bd.role` | `'bd' \| 'admin'` | The owner is seeded as the first admin (R5). |
| `person` | id, `profile_key` (unique, nullable), first/last name, `email`, `email_normalized`, `email_status`/`confidence`/`source`, `company`, `company_key`, `company_category`, `job_title`, `role_group`, `seniority`, `industry`, city/region/country, `owner_bd_id`, `status`, `status_activity_id`, `source_key`, `merged_into_id`, `migration_run_id`, created/updated at, `updated_by_bd_id` | Rows with `merged_into_id` set are hidden from every read. Indexes: owner, status, company_key, email_normalized, (lower name, company_key). |
| `person_bd_connection` | PK(person_id, bd_id), `connected_on date`, `legacy_contact_id`, message counts, first/last message at, `initiated_by_me`, `reciprocal` | This is where "connected BDs" and "conversation history exists with" come from. |
| `person_property_history` | person_id, property, old/new value, `changed_by_bd_id`, `source` (`edit`/`merge`/`import`/`migration`), at | Feeds the "last updated by X" hint (R7). |
| `person_id_map` | (`legacy_table`, `legacy_id`) PK → `person_id`, `method` (`profile_key`/`verified_email`/`review`/`new`/`skipped_own_company`), `migration_run_id` | Success criterion: every legacy id resolves. Own-company rows map to a null `person_id`, and the redirect answers them with a 404. |
| `merge_event` | survivor_id, merged_id, `reason`, actor_bd_id (null = migration), `snapshot jsonb` (both rows, losing values, re-pointed ids per table), undone_at, undone_by | Unmerge replays the snapshot in reverse. |
| `duplicate_candidate` | person_a_id < person_b_id (unique pair), `reason='name_company'`, `match_key`, `status` (`open`/`merged`/`not_duplicate`), decided_by/at | A `not_duplicate` pair is never proposed again. |
| `audit_log` | actor_bd_id, `action` (`view_conversation`, `merge`, `unmerge`, `not_duplicate`, `migration_approve`, `migration_execute`), person_id, target_bd_id, metadata, at | Append-only. |
| `migration_run` | kind (`collapse`/`fold_leads`), mode (`dry_run`/`execute`), `input_hash`, `report jsonb`, approved_by/at, executed_at | Holds the R10 gate. |
| `saved_view` | owner_bd_id, name, `filters`/`columns`/`sort` jsonb, position | Personal views only (D7). |
| `activity` + `person_id`, `actor_bd_id` | | `activity` has no author column today. Derivation and attribution need one. |
| `task`, `signal`, `linkedin_scrape_job` + `person_id` | | Legacy FK columns stay until a cleanup change. |

**New activity types**: `meeting_logged` {at, notes}, `discarded` {reason: `wrong_profile`/`not_interested`/`other_vendor`/`left_company`/`bad_data`/`other`, note (required when reason is `other`)}, `status_backfill` {status, originalEditorBdId, originalAt}, `reply_received` (reserved for email sync). The existing types are `note`, `email_sent`, `hunter_lookup` and `status_change`. `status_change` becomes read-only history.

## Status derivation (R4)

```
rank: new 0 < contacted 1 < replied 2 < meeting 3
events  = activities(person) + connections(person).{sentCount>0 → contacted, receivedCount>0 → replied}
stage   = max rank over events            (combined across BDs)
status  = latest `discarded` is newer than every stage event ? discarded : stage
```

Any activity logged after a discard un-discards the Contact. `deriveStatus` returns `{ status, because: activityId | connection }`. The record page uses `because` for the "why" hint.

## Identity matcher (R2, R8)

```ts
type MatchResult =
  | { kind: "skip_own_company"; reason: "name" | "domain" }   // ownCompanyMatchReason()
  | { kind: "auto"; personId: string; key: "profile_key" | "verified_email" }
  | { kind: "review"; personIds: string[]; key: "name_company" }
  | { kind: "new" };
interface IdentityIndex { byProfileKey(k): Id | null; byVerifiedEmail(e): Id | null; byNameCompany(k): Id[] }
```

The matcher tries keys in this order: own company (`src/lib/ownCompany.ts`), then profile key (existing `normalizeProfileKey` in `src/lib/csv.ts`), then email only when **both** sides are `verified`, then name + `normalizeCompanyKey`. A name match never auto-merges. It creates the new person and opens a `duplicate_candidate`, so no data waits on the review.

**Merge property rule (R7)**, pure `mergeProperties(a, b)`: the more specific value wins (non-null over null, `verified` over `probable`, a longer title over a generic one), and ties go to the most recent value. Losing values go into `merge_event.snapshot`. Notes become `note` activities with attribution.

## Migration plan (R10)

| Step | Script / surface | Output |
|---|---|---|
| 1 Collapse | `scripts/unify-contacts.ts --phase=collapse --dry-run` | `migration_run` report: persons created, contacts auto-merged by profile key, own-company skipped, connections per BD |
| 2 Approve | `/admin/migration` (admin) → "Approve dry run" | `audit_log`, `approved_by` |
| 3 Execute | `--execute --run=<id>`: refuses if `input_hash` changed or the run is not approved. A production backup is taken first. | Rows tagged with `migration_run_id` |
| 4 Fold leads | same script `--phase=fold_leads` | Leads auto-merged by verified email, sent to review, new. Re-point counts for `activity`/`task`/`signal`/`linkedin_scrape_job`. `status_backfill` and note activities written. |

The owner is the BD with the earliest `connected_on`. The script parses LinkedIn's `"12 Mar 2021"` text; unparseable dates sort last. If no BD has a connection, the lead's owner is kept (R3).
**Rollback**: revert the read-switch commit, then `DELETE … WHERE migration_run_id = X` in FK order. Legacy tables are never written.

## Routes

| Route | Change |
|---|---|
| `/contacts` | New list. `?view=`, filters and `?layout=board` all live in the query string. |
| `/contacts/[id]` | New three-pane record |
| `/contacts/import` | Moves CSV upload here and shows the dedup outcome |
| `/admin/duplicates`, `/admin/migration` | Admin only (`requireAdmin`); non-admins get a 404 |
| `/leads`, `/outreach` | Redirect to `/contacts?view=…`. "Generate message" moves to the record. |
| `/leads/[id]`, `/contact/[id]` | Redirect via `person_id_map` (D8) |
| `/hiring`, `/companies`, `/tasks`, … | Restyle only in a later change; they adopt the shell now |

**Design-system scope (design-system spec)**: every screen from `/login` onward gets a mockup **now**, so the owner approves one visual language. Implementation splits in two:

| Applies app-wide when the shell ships (PR 8) | Deferred to later changes |
|---|---|
| App shell (`Sidebar` + `TopBar`), token additions in `globals.css` (status, info and badge-text tokens, darker accent hover), light-only (no theme switcher), and removal of the 14 hardcoded badge hex literals in `companies/[key]/page.tsx` and `leads/[id]/page.tsx` | Page-body restyle of `/tasks`, `/companies`, `/companies/[key]`, `/hiring`, `/whats-new`, `/discovery`, `/account*` and `/login` to match their mockups |

Deferred pages keep their current bodies inside the new shell. Because they consume tokens, they pick up token changes automatically.

**Outreach → saved views**: the `roleGroup`, `companyCategory`, `market`, `miamiOnly`, `hideOffshore` and `startupsOnly` filters become Contact filters. `excludeNever` becomes `status = new`. The system views are *All*, *My contacts* (owner = me), *Not contacted* (status new), *New with verified email*, *Hiring companies* (company_key in active target companies) and *Outreach-ready* (hiring + new + verified email).

**Conversation privacy (R6)**: message reads keep `bd_id = me`. `getConversationForAdmin(personId, bdId)` is the only path around that rule, and it writes `audit_log(view_conversation)` before it returns content.

## Testing strategy

| Layer | Target | Approach |
|---|---|---|
| Unit (strict TDD) | `normalize`, `matcher`, `deriveStatus`, `mergeProperties`, migration planner (rows → plan and counts), view filter serialization, `ClientStrings` walker | `node:test` via `npm run test:unit` (`tests/unit/*.test.ts`) |
| Dry run | Collapse and fold on a production snapshot | The report itself is the check: reviewed counts and zero orphans |
| E2E | Redirects, admin 404 for non-admins, audit row on admin view | Existing Playwright (`npm run test:e2e`) |

## Review Workload Forecast

| PR | Slice | Content | Est. lines | 400 risk |
|---|---|---|---|---|
| 1 | 0 | Schema 0013, `bd.role`, `requireAdmin`, audit tables | ~220 | Low |
| 2 | 0 | Identity module and tests | ~320 | Med |
| 3 | 0 | Collapse planner, dry-run script, `/admin/migration` | ~380 | Med |
| 4 | 0b | Fold leads, re-point, backfill activities | ~360 | Med |
| 5 | 0b | `deriveStatus`, activity writes, outreach/hiring re-scope | ~350 | Med |
| 6 | 1 | Merge/unmerge engine and tests | ~300 | Med |
| 7 | 1 | `/admin/duplicates` UI | ~280 | Low |
| 8 | UI | App shell and top bar, new tokens from `mockups/styles.css`; remove `LocaleSwitcher` and the `en` dictionary usage path (R11, D10) | ~300 | Low |
| 9–11 | 2 | Record: shell and About; timeline filter and log dialogs; associations, admin view, redirects | ~350 each | Med |
| 12–14 | 3 | List: views and filters; columns and bulk; board and import | ~350 each | Med |

**Total ≈ 4,800 lines across 14 PRs. Chained PRs recommended: Yes. Decision needed before apply: Yes** (chain strategy). Each PR stays under 400 lines if the split holds.

**Spanish-only UI (R11) adds work**: existing hardcoded English UI strings on every touched screen (record, list, board, duplicates, dry-run report, admin pages) must move into the `es` dictionary as that screen is touched — this is folded into each screen's own PR (9–14), not a separate PR. Removing the switcher and the `en` usage path is part of PR 8 (the shell PR), where it is a small, low-risk deletion.

## Preconditions and open questions

- [ ] The uncommitted dark-mode removal must be committed before PR 8.
- [x] A new activity after a discard un-discards the Contact (confirmed by the owner, 2026-09-24).
- [x] Discard reasons confirmed by the owner (see New activity types). They are fixed codes so the future `owner-reporting` change can aggregate them.
- [x] Top-bar search covers Contacts only in this change (`/contacts?q=`, by name, email, company, LinkedIn). Global search stays in the backlog (confirmed).
- [x] Accessibility token changes approved by the owner: accent hover darkens instead of lightening; darker badge text.
- [x] Delivery: chained PRs with `feature-branch-chain` (tracker branch, Vercel preview deploys, one merge to `main` at the end).
- [ ] Contact source provenance (LinkedIn, imported list, scraping) is stored as a structured field on every Contact, for `owner-reporting`.

## Write cutover & catch-up (Phase 4B addendum)

### Context

`person` was populated by collapse run `b9003aae`. No live path writes `person`, `person_bd_connection`, `person_id_map` or `person_id`: `upsertContacts` (`src/lib/queries.ts:456`), `recomputeMessageSignals` (`src/lib/queries.ts:746`, updates per-BD message aggregates), `importLeads`, `updateLeadStatus`, `updateLeadOwner` (`src/lib/leads/queries.ts`), `createActivity` (+ Gmail log), `createTask`/`updateTask`, manual signal. Phase 5 re-scopes reads to `person`, so everything written after the run would disappear.

| # | Topic | Choice | Rejected | Why |
|---|---|---|---|---|
| D11 | Ordering | New Phase 4B (PRs 4B-1..4B-4) after PR 4, before PR 5. PR 5 is blocked until the 4B gate closes. Legacy writes continue (dual-write); legacy stays the rollback source. | Folding cutover into PR 5 | Reads must never switch before writes. |
| D12 | Shared resolver | `src/lib/identity/resolve.ts`: `planIdentityWrites(rows, index)` (pure) + `applyIdentityWrites(tx, plan)`. Used by live paths AND catch-up; dry-run = plan only. | Separate live and migration logic | One rule set; no drift between catch-up and live. |
| D13 | Per-request matching | Keep the synchronous `IdentityIndex`. Per chunk, prefetch only candidates: `profile_key = ANY($1)` (unique idx), `email_normalized = ANY($2) AND email_status='verified' AND merged_into_id IS NULL` (idx), `company_key = ANY($3)` (idx) with `buildNameCompanyKey` filtered in app (the existing name index is on raw, not accent-folded, names). Merged hits resolve to survivor. Rows created earlier in the same chunk join the in-memory index. | Async DB index per row (~3 queries/row, 1,500 per 500-row chunk); loading all 19.7k persons per request | 3 indexed queries per chunk; set-based writes. |
| D14 | Concurrency | Each chunk runs in one `db.transaction` (none today): legacy upsert, then `pg_advisory_xact_lock(IDENTITY_LOCK)`, then prefetch, match, batched writes. Person insert uses `ON CONFLICT (profile_key) DO NOTHING RETURNING`; conflicting keys are re-selected and treated as `auto`. `person_bd_connection` upserts on its PK; `person_id_map` and `duplicate_candidate` use `ON CONFLICT DO NOTHING`. | Per-key advisory locks (hundreds per chunk, deadlock ordering); SERIALIZABLE + retry (chunk-level retries); partial unique index on verified email (existing conflicting-key data may violate it; conflicts are allowed and go to review) | Only profile key has a unique constraint. The global lock serializes person-creating transactions only; these are rare (uploads, lead ingest), about 1 s per chunk. The xact-scoped lock works on a transaction-mode pooler. |

**Reference writes** (no matcher, no lock): `activity`/`task`/`signal` inserts set `person_id` in the same statement via `(SELECT person_id FROM person_id_map WHERE legacy_table=$t AND legacy_id=$id)` (PK lookup) plus `actor_bd_id`; `updateTask` re-resolves on subject change. `updateLeadStatus` appends a `status_change` activity carrying `person_id` (evidence for `deriveStatus`). `updateLeadOwner` sets `person.owner_bd_id` only when the person has no `person_bd_connection` (R3) and writes `person_property_history`. `recomputeMessageSignals` gets a second set-based `UPDATE person_bd_connection … FROM peer_agg JOIN person_id_map`.

**Kill switch**: env `IDENTITY_DUAL_WRITE=off` skips identity writes (legacy writes unaffected). A catch-up closes any gap it opens.

### Catch-up (owner D4b)

- `scripts/unify-contacts.ts --phase=catch_up`, `migration_run.kind='catch_up'`.
- Input (keyset-paged anti-join): `contact`/`lead` rows `WHERE NOT EXISTS (person_id_map m WHERE m.legacy_table=… AND m.legacy_id=x.id)`; reference rows with `person_id IS NULL AND (contact_id OR lead_id) IS NOT NULL`, re-pointed by one `UPDATE … FROM person_id_map` per table; drift in mapped rows (leads by `updated_at > run.executed_at`; contacts, which lack `updated_at`, via the existing `planCollapseMergeRepair` diff core).
- `input_hash` = sorted `(table, id)` of the whole input. Dry-run → `/admin/migration` approval → guarded `--execute` (hash check, `pg_dump`, `audit_log(migration_execute)`), 1,000-row batches.
- Idempotent: a second run finds zero rows. Fold-leads's lead reader (`readUnmappedLeadRowsForFold`) uses the exact same `NOT EXISTS (person_id_map ...)` anti-join as catch-up's readers, plus `ON CONFLICT DO NOTHING` on its `person_id_map` insert as belt-and-braces — so fold-leads can run before OR after catch-up (or after the live cutover has mapped some leads) without re-planning an already-mapped lead or hitting the `person_id_map` primary key.
- **Required order**: `collapse --execute` → `fold_leads --execute` → deploy the live dual-write cutover (or deploy it earlier — now safe, since fold-leads is anti-join safe) → `catch_up`. `--phase=catch_up` (dry-run AND execute) refuses via `src/lib/migration/phaseOrderGuard.ts#assertCatchUpPhaseOrderAllowed` unless both `collapse` and `fold_leads` have an EXECUTED run (`mode=execute` + `executedAt` set) — a dry-run or merely-approved run of either does not satisfy the gate. `fold_leads` itself is NOT gated on catch-up.
- **Residual risk**: catch-up's row prefetch (`readUnmappedContacts`/`readUnmappedLeads`/`readExistingPersonsForCatchUp`) runs outside the `pg_advisory_xact_lock` `withIdentityLock` takes around the execute transaction's writes. A concurrent live write that creates the same verified-email `person` in that gap can make `--execute` fail — it rolls back cleanly and is safe to re-run (the anti-join means the retry only reprocesses what is still unmapped). Recommended: run `--phase=catch_up --execute` in a low-traffic window to minimize this window.

**Deploy sequence (needs owner confirmation)**: PENDING OWNER DECISION. Under feature-branch-chain, cutover code reaches prod only when the tracker merges, together with the Phase 5 reads. Recommended: release the chain up to PR 4B-4 to `main` early (no visible change), then run catch-up. The unmapped set is then frozen and the hash is stable. Fallback that keeps the single final merge: run catch-up #1 just before the deploy (D4b), then a small catch-up #2 immediately after, to sweep writes made in between. Rows stay invisible until #2 executes.
