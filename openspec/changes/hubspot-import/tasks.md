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

- [ ] 1.1 RED: write failing tests for `src/lib/hubspot/uuidv5.ts` — `HUBSPOT_NAMESPACE` pinned test vector; `hubspotLegacyId(id)` deterministic (design D1; contact-migration "External non-uuid legacy id mapping").
- [ ] 1.2 GREEN: implement `uuidv5.ts` over `node:crypto` SHA-1, no new dependency.
- [ ] 1.3 RED/GREEN: `src/lib/hubspot/columns.ts` pins header strings (NFC+trim comparison); missing required header fails listing missing names (not PII).
- [ ] 1.4 RED/GREEN: `src/lib/hubspot/parse.ts` — `csv-parse` stream over `fs.createReadStream(path,"utf8")`, `bom:true`, `columns:true`, `skip_empty_lines:true`, `relax_column_count:false`, `max_record_size:2_000_000`; parser errors rethrown as `Error("CSV parse failed at line N (code)")`, never the raw `CsvError`/`record`/`raw` (D2, D8 — PII rule: sanitize csv-parse errors).
- [ ] 1.5 RED/GREEN: `src/lib/hubspot/contacts.ts` — pure row → typed `HubSpotContactRow` mapper (trim, blank→null, integers, dates, URL normalization).
- [ ] 1.6 RED/GREEN: `src/lib/hubspot/owners.ts` — `normalizeNameKey(hubspotOwner) === normalizeNameKey(bd.name)`; blank/`(Deactivated…)` suffix → unassigned; unknown name → unassigned + counted (hubspot-import spec "Owner mapping").
- [ ] 1.7 Test: `.gitignore` still excludes `hubspot/` (D8 PII rule — export files never committed).

## Phase 2: Company Resolution + Migration 0015 (PR H2, base: PR H1)

- [ ] 2.1 **GATE (owner/orchestrator)**: apply migration `drizzle/0015_company_domain.sql` to prod BEFORE any dry run against production data.
- [ ] 2.2 Write `drizzle/0015_company_domain.sql` + `drizzle/meta/*`: `company.domain text` + partial unique index (domain not null). `src/db/schema.ts` updated.
- [ ] 2.3 Test: `tests/unit/drizzleJournal.test.ts` — 0015's journal `when` exceeds 0014's `1790713471556`.
- [ ] 2.4 RED/GREEN: `src/lib/hubspot/companies.ts` (pure) — group by normalized domain (lowercase, no protocol/`www.`/path); per group, match by domain, then by `companyKey` of each name, else create; representative = most primary contacts, ties → lowest ID; name match fills empty `domain` only.
- [ ] 2.5 RED/GREEN: own-company groups (`ownCompanyMatchReason`, name or domain) create nothing; their contacts are skipped and counted `skipped_own_company`.
- [ ] 2.6 RED/GREEN: company rows created ONLY for groups that are the primary company of ≥1 imported contact, or that carry a note (hubspot-import spec "Company matching and creation" — no-op scenario for unlinked, note-less companies).
- [ ] 2.7 RED/GREEN: `Associated Note` → `activity{companyKey, type:'note', actorBdId:null, metadata:{body, source:'hubspot_import', hubspotCompanyId}}`; skipped if one with the same `hubspotCompanyId` already exists.
- [ ] 2.8 Test: no-company-resolved fallback counted as `noCompanyResolved` when `Associated Company IDs (Primary)` is absent or unresolved.

## Phase 3: Identity Planning + Activities (PR H3, base: PR H2)

- [ ] 3.1 RED/GREEN: `src/lib/identity/matcher.ts` — add `IdentityIndex.byEmail(email): PersonId[]`; after strong keys, exact email match where either side is not `verified` → `review` with reason `email_unverified`, scoped ONLY to rows sourced from `hubspot_import` (contact-identity delta — live ingest/`catch_up` unchanged).
- [ ] 3.2 RED/GREEN: `buildNameCompanyKey` prefers an explicit `companyKey` (domain-resolved key from Phase 2 used for matching).
- [ ] 3.3 RED/GREEN: `src/lib/identity/resolve.ts`/`resolveDb.ts` — nullable `bdId`, no `person_bd_connection` for HubSpot rows; optional `ownerBdId`/`company`/`city`/`country`/`migrationRunId`; `mergePolicy: 'r7' | 'fill_empty'`, HubSpot uses `fill_empty`.
- [ ] 3.4 RED/GREEN: mapper — HubSpot rows → `IdentityIngestRow` with `legacyTable:'hubspot_contact'`, `profileKey=normalizeProfileKey(linkedin)`, `emailStatus:'probable'`, `emailSource:'hubspot_import'`, `sourceKey:'hubspot_import'` (contact-identity "HubSpot emails are stored as probable").
- [ ] 3.5 RED/GREEN: `src/lib/hubspot/statusEvidence.ts` (pure) — emit at most one stage backfill + at most one discard per the evidence table (D5): `contacted` / `replied` / `discarded(wrong_profile)` / nothing. Discard emits `status_backfill{status:'discarded', reason:'wrong_profile'}`, never a plain `discarded`-type row, so the historical `originalAt` is preserved (hubspot-import spec "Discard evidence preserves the historical date").
- [ ] 3.6 RED/GREEN: `originalAt` resolution — `Último contacto` → `Última actividad` → `Fecha de creación`, portal timezone; all-fail → run time + `dateFallback` increment.
- [ ] 3.7 RED/GREEN: idempotency key `(hubspotContactId, status)` — later export can advance status without duplicate activities.
- [ ] 3.8 RED/GREEN: `src/lib/hubspot/refill.ts` — `planHubSpotRefill` fills only null/empty fields on re-import (Q3); email fields move together, fill only when `email` is null; every filled field writes `person_property_history(source:'import')`; profile-key auto-match gets the same fill-empty treatment.
- [ ] 3.9 RED/GREEN: `src/lib/hubspot/planner.ts` — orchestrates companies → contacts → identity (`planIdentityWrites`) → refill → activities, pure, single entry point for the dry-run/execute ports.
- [ ] 3.10 Test: row outcome classification — every row lands in exactly one of `new`/`review`/`profile_key`/`skipped_own_company`/`already_imported`/`invalid` (hubspot-import spec "Row classification per contact").

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
