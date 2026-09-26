# Tasks: HubSpot Contacts Import

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1,700 code across 5 PRs (tests/docs excluded) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR H1 → PR H5 (see table below) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes (owner already resolved chain strategy = feature-branch-chain)
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

**Tracker branch**: `feat/hubspot-import-plan` (no-merge; only this merges to `main`). PR H1 targets the tracker; each later PR targets the immediately previous PR's branch. Owner reviews via Vercel preview deploys (read-only reads only — no HubSpot PII ever committed).

### Suggested Work Units

| PR | Title | Base branch | Est. lines | Gate |
|---|---|---|---|---|
| H1 | Pure parsing + mapping (`columns`, `uuidv5`, `parse`, `contacts`, `owners`) | tracker | ~380 | TDD |
| H2 | Company resolution + migration 0015 (`company.domain`) | PR H1 | ~340 | **Owner applies 0015 in prod** |
| H3 | Identity planning + activities (matcher, resolver, status evidence, refill, planner) | PR H2 | ~400 | TDD |
| H4 | DB wiring + CLI phase + report (queries, `hubspotRun`, guards, script) | PR H3 | ~380 | **Dry-run review + approve + execute** |
| H5 | `/admin/migration` HubSpot section + labels | PR H4 | ~260 | Mockup-free (reuses existing admin page pattern) |

## Phase 1: Parsing & Mapping (PR H1, base: tracker)

- [x] 1.1 RED: write failing tests for `src/lib/hubspot/uuidv5.ts` — `HUBSPOT_NAMESPACE` pinned test vector; `hubspotLegacyId(id)` deterministic (design D1; contact-migration "External non-uuid legacy id mapping").
- [x] 1.2 GREEN: implement `uuidv5.ts` over `node:crypto` SHA-1, no new dependency.
- [x] 1.3 RED/GREEN: `src/lib/hubspot/columns.ts` pins header strings (NFC+trim comparison); missing required header fails listing missing names (not PII).
- [x] 1.4 RED/GREEN: `src/lib/hubspot/parse.ts` — `csv-parse` stream over `fs.createReadStream(path,"utf8")`, `bom:true`, `columns:true`, `skip_empty_lines:true`, `relax_column_count:false`, `max_record_size:2_000_000`; parser errors rethrown as `Error("CSV parse failed at line N (code)")`, never the raw `CsvError`/`record`/`raw` (D2, D8 — PII rule: sanitize csv-parse errors).
- [x] 1.5 RED/GREEN: `src/lib/hubspot/contacts.ts` — pure row → typed `HubSpotContactRow` mapper (trim, blank→null, integers, dates, URL normalization).
- [x] 1.6 RED/GREEN: `src/lib/hubspot/owners.ts` — `normalizeNameKey(hubspotOwner) === normalizeNameKey(bd.name)`; blank/`(Deactivated…)` suffix → unassigned; unknown name → unassigned + counted (hubspot-import spec "Owner mapping").
- [x] 1.7 Test: `.gitignore` still excludes `hubspot/` (D8 PII rule — export files never committed).

**Post-review fixes (fresh review of PR H1):** the real export has BOTH
`LinkedIn` (~0.6% filled, holds the actual profile URL) and `URL de
LinkedIn` (~0% filled) — `contacts.ts` now reads both and keeps the first
non-blank, `LinkedIn` first; neither is in `REQUIRED_CONTACT_HEADERS`
anymore, only pinned as `OPTIONAL_CONTACT_LINKEDIN_HEADERS` (columns.ts).
Timestamp fields (`Último contacto`/`Última actividad`/`Fecha de creación`,
format `YYYY-MM-DD[ HH:mm]`) are parsed as the HubSpot portal's timezone,
confirmed by the owner as `America/Argentina/Buenos_Aires` (fixed UTC-3, no
DST) — via pure `Date.UTC` arithmetic (`HUBSPOT_PORTAL_TIMEZONE` constant in
contacts.ts), independent of the running process's TZ (proven under both
`TZ=UTC` and `TZ=America/New_York`), instead of `new Date(string)` which
depended on it. `Associated Company IDs (Primary)` can carry more than one
semicolon-separated id — only the first is kept, and
`associatedCompanyIdPrimaryMultiple` flags it for the import report. Also
added `assertNoDuplicateRequiredHeaders` (columns.ts) wired into
`parseHubSpotCsv` (parse.ts): csv-parse's `columns:true` silently keeps only
the last occurrence of a duplicated header (the export has dupes, e.g.
"Función laboral" x2, "Billing Contact IDs" x3) — this now throws a
sanitized error if a *required* header name repeats.

## Phase 2: Company Resolution + Migration 0015 (PR H2, base: PR H1)

- [ ] 2.1 **GATE (owner/orchestrator)**: apply migration `drizzle/0015_company_domain.sql` to prod BEFORE any dry run against production data.
- [x] 2.2 Write `drizzle/0015_company_domain.sql` + `drizzle/meta/*`: `company.domain text` + partial unique index (domain not null). `src/db/schema.ts` updated.
- [x] 2.3 Test: `tests/unit/drizzleJournal.test.ts` — 0015's journal `when` exceeds 0014's `1790713471556`.
- [x] 2.4 RED/GREEN: `src/lib/hubspot/companies.ts` (pure) — group by normalized domain (lowercase, no protocol/`www.`/path); per group, match by domain, then by `companyKey` of each name, else create; representative = most primary contacts, ties → lowest ID; name match fills empty `domain` only.
- [x] 2.5 RED/GREEN: own-company groups (`ownCompanyMatchReason`, name or domain) create nothing; their contacts are skipped and counted `skipped_own_company`. (Company-side primitive: `resolveContactCompanyKey` returns `ownCompany:true`, `companyKey:null`. Actual contact skip + `skipped_own_company` counter wiring happens in Phase 3's `planner.ts`, task 3.9.)
- [x] 2.6 RED/GREEN: company rows created ONLY for groups that are the primary company of ≥1 imported contact, or that carry a note (hubspot-import spec "Company matching and creation" — no-op scenario for unlinked, note-less companies).
- [x] 2.7 RED/GREEN: `Associated Note` → `activity{companyKey, type:'note', actorBdId:null, metadata:{body, source:'hubspot_import', hubspotCompanyId}}`; skipped if one with the same `hubspotCompanyId` already exists. (`companies.ts#notesToCreate` plans the note; wiring it to an actual `activity` insert with `actorBdId:null` happens in Phase 4's execute transaction, since this PR stays DB-write-free.)
- [x] 2.8 Test: no-company-resolved fallback counted as `noCompanyResolved` when `Associated Company IDs (Primary)` is absent or unresolved.

**Post-review fixes (fresh review of PR H2):** `planCompanyResolution` built
its existing-company lookup maps once from the DB snapshot and never
updated them while processing groups, so two HubSpot company groups
normalizing to the same `companyKey` (e.g. "Acme Corp" / "Acme Corp." with
different domains, or both domain-less) both landed in `companiesToCreate`
with the same key — a `company.company_key` primary-key violation at
execute time — and the same gap let two groups name-match the same
existing domain-less company and both queue a conflicting `DomainFill`.
Groups are now processed in ascending `hubspotCompanyId` order
(deterministic regardless of input row order) and each group's resolution
is registered into the lookup maps as it resolves, so a later colliding
group links to the earlier one's company instead of duplicating it; when
two groups disagree on which domain a shared `companyKey` should carry,
the first one processed keeps its domain and the second is reported in a
new `domainConflicts` list on the result instead of being silently dropped
or overwriting the winner. `normalizeDomain` also now strips a trailing
port (`acme.com:8080`) and a trailing dot (`acme.com.`), both seen in real
exports, which previously split one company's domain group into two.

## Phase 3: Identity Planning + Activities (PR H3, base: PR H2)

- [x] 3.1 RED/GREEN: `src/lib/identity/matcher.ts` — add `IdentityIndex.byEmail(email): PersonId[]`; after strong keys, exact email match where either side is not `verified` → `review` with reason `email_unverified`, scoped ONLY to rows sourced from `hubspot_import` (contact-identity delta — live ingest/`catch_up` unchanged).
- [x] 3.2 RED/GREEN: `buildNameCompanyKey` prefers an explicit `companyKey` (domain-resolved key from Phase 2 used for matching).
- [x] 3.3 RED/GREEN: `src/lib/identity/resolve.ts`/`resolveDb.ts` — nullable `bdId`, no `person_bd_connection` for HubSpot rows; optional `ownerBdId`/`company`/`city`/`country`/`migrationRunId`; `mergePolicy: 'r7' | 'fill_empty'`, HubSpot uses `fill_empty`.
- [x] 3.4 RED/GREEN: mapper — HubSpot rows → `IdentityIngestRow` with `legacyTable:'hubspot_contact'`, `profileKey=normalizeProfileKey(linkedin)`, `emailStatus:'probable'`, `emailSource:'hubspot_import'`, `sourceKey:'hubspot_import'` (contact-identity "HubSpot emails are stored as probable").
- [x] 3.5 RED/GREEN: `src/lib/hubspot/statusEvidence.ts` (pure) — emit at most one stage backfill + at most one discard per the evidence table (D5): `contacted` / `replied` / `discarded(wrong_profile)` / nothing. Discard emits `status_backfill{status:'discarded', reason:'wrong_profile'}`, never a plain `discarded`-type row, so the historical `originalAt` is preserved (hubspot-import spec "Discard evidence preserves the historical date").
- [x] 3.6 RED/GREEN: `originalAt` resolution — `Último contacto` → `Última actividad` → `Fecha de creación`, portal timezone; all-fail → run time + `dateFallback` increment.
- [x] 3.7 RED/GREEN: idempotency key `(hubspotContactId, status)` — later export can advance status without duplicate activities.
- [x] 3.8 RED/GREEN: `src/lib/hubspot/refill.ts` — `planHubSpotRefill` fills only null/empty fields on re-import (Q3); email fields move together, fill only when `email` is null; every filled field writes `person_property_history(source:'import')`; profile-key auto-match gets the same fill-empty treatment.
- [x] 3.9 RED/GREEN: `src/lib/hubspot/planner.ts` — orchestrates companies → contacts → identity (`planIdentityWrites`) → refill → activities, pure, single entry point for the dry-run/execute ports.
- [x] 3.10 Test: row outcome classification — every row lands in exactly one of `new`/`review`/`profile_key`/`skipped_own_company`/`already_imported`/`invalid` (hubspot-import spec "Row classification per contact").

**Post-implementation notes (PR H3):** `IdentityIndex.byEmail` returns every
live person matching an email regardless of status (unlike
`byVerifiedEmail`, which only ever holds a hit whose OWN email is
verified) — `matchIdentity` only consults it when `row.source ===
'hubspot_import'`, checked after the strong keys and before name+company,
so live ingest/`catch_up` (which never set `source`) are provably
unaffected (`identityMatcher.test.ts`/`identityResolve.test.ts` both
assert this explicitly). `mergePolicy: 'fill_empty'` lives in
`planIdentityWrites`/`mergeFields` alongside the existing `'r7'` default —
HubSpot rows always pass `'fill_empty'`; every other caller
(collapse/fold/live resolver) keeps the default, unchanged. `person.company`
(raw display text) is now read/written by the resolver for the first time
(it was silently dropped before this PR) — a pre-existing gap, not a
behavior change for existing callers, since `company` was never populated
on `person` from the live path either way. `already_imported` rows never
touch the matcher or `planIdentityWrites` at all — they route straight
through `planHubSpotRefill` against the prefetched existing-person
snapshot (Phase 4 wires that prefetch). `invalid` is defined as a
`hubspotContactId` repeated more than once within the same export file
(every occurrence after the first) — not explicitly enumerated by the
spec's classification scenarios, but required by design D7's report shape
(`outcomes.invalid`) and by "every row lands in exactly one outcome."
Also fixed, as a directly-related spec requirement not on this phase's
task list: the record page's timeline only showed a discard `reason` for
a plain `discarded` activity, never for a `status_backfill{status:
'discarded'}` row (which is exactly what `statusEvidence.ts` writes, to
preserve the historical date) — extracted the pure body formatter into
`src/lib/contacts/timelineEntryBody.ts` (Timeline.tsx pulls in
`@/lib/activity/queries`'s DB-touching value exports, so the formatter
couldn't be unit-tested in place) and made both cases share the same
reason display.

## Phase 4: DB Wiring + CLI Phase + Report (PR H4, base: PR H3)

- [ ] 4.1 `src/lib/hubspot/importQueries.ts` — snapshot reads (prefetched persons, existing hubspot map rows, touched companies, bd name map, existing hubspot activity keys) and `finalizeHubSpotExecute`.
- [ ] 4.2 `src/lib/migration/hubspotRun.ts` — dry-run/execute ports mirroring `catchUpRun.ts`.
- [ ] 4.3 `src/lib/migration/cliArgs.ts` — `--phase=hubspot_import --file=<path> --companies=<path> [--dry-run | --execute --run=<id>]`; requires both paths for this phase, rejects them for other phases.
- [ ] 4.4 `src/lib/migration/executionGuard.ts` — `MigrationRunKind` gains `hubspot_import`; new block reason `review_threshold_unconfirmed` (hubspot-import spec "Review-count threshold gate", `HUBSPOT_REVIEW_THRESHOLD=300`).
- [ ] 4.5 `src/lib/migration/inputHash.ts` — `hashRowSet` over projected contact rows + company rows (`id`=HubSpot ID) plus the DB snapshot the planner reads.
- [ ] 4.6 `src/lib/migration/backup.ts` — add `company` to `BACKUP_TABLES`.
- [ ] 4.7 `scripts/unify-contacts.ts` — wire `--phase=hubspot_import`; execute order: pre-check hash → `snapshotBackup` → one transaction (claim run → `pg_advisory_xact_lock(IDENTITY_LOCK_KEY)` → re-prefetch/re-hash inside lock, abort on mismatch → companies → persons/map/candidates → refill → activities → `recomputePersonStatuses` → report/`executedAt`/`audit_log(migration_execute)`). Batch size `WRITE_BATCH_SIZE=1000`.
- [ ] 4.8 `src/lib/hubspot/report.ts` — `redactReportForLog(report)`: counts only, `reviewSample` removed, owner maps collapsed to counts; phase catches its own errors and prints a sanitized message, never raw `err` (D8 PII rule).
- [ ] 4.9 Test: dry-run mode never writes `person`/`company` rows; execute refuses on stale `input_hash`, missing approval, or unconfirmed over-threshold review count.
- [ ] 4.10 **GATE (owner)**: review the `hubspot_import` dry-run report in `/admin/migration` against the real export (read-only prod smoke: run `--dry-run` against prod DB snapshot reads only, zero writes) before approving.
- [ ] 4.11 **GATE (owner)**: approve the run in `/admin/migration` (confirm-over-threshold checkbox if `review > 300`).
- [ ] 4.12 **GATE (owner)**: `--execute --run=<id>` in the low-traffic window; verify `pg_dump` backup succeeded first.
- [ ] 4.13 Test: re-running the dry-run after execute reports 0 `new` rows (idempotent re-import scenario).

## Phase 5: Admin UI + Labels (PR H5, base: PR H4)

- [ ] 5.1 `/admin/migration` gets an "Importación de HubSpot" section: latest report (counts, `reviewSample` admin-only), approve action with the over-threshold confirmation checkbox ("Confirmo N contactos a revisar").
- [ ] 5.2 `src/app/(app)/admin/migration/actions.ts` — approve action wired to `review_threshold_unconfirmed` guard from 4.4.
- [ ] 5.3 `es.migration`/`en` dictionary entries — neutral Spanish, following `mockups/GLOSSARY.md`; label for the new review reason `email_unverified`.
- [ ] 5.4 E2E/manual: non-admin gets 404 on the HubSpot section; admin approve-over-threshold without the checkbox is blocked with a distinct message.

## PII & Safety Rules (apply across all phases)

- Never commit or print raw HubSpot rows (names, emails, phone numbers) anywhere — logs, errors, or report fields outside `reviewSample` (admin-only, DB-persisted).
- `csv-parse` errors are caught and rethrown sanitized (line + code only); never let Node's default error path print `CsvError.record`/`.raw`.
- Every new read path introduced in Phase 4 MUST be exercised read-only against prod (dry-run only) before any write path is approved — no direct prod writes outside the gated execute transaction.
- `hubspot/` stays git-ignored; `backups/` stays git-ignored.

## Next Step

Ready for implementation (`sdd-apply`), starting with PR H1. Gate 2.1 (migration 0015 in prod) and gates 4.10–4.12 (dry-run review/approve/execute) require explicit owner action — `sdd-apply` MUST stop and report rather than proceeding past them.
