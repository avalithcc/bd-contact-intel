# Design: HubSpot Contacts Import

## Technical Approach

A new gated migration phase, `hubspot_import`, in `scripts/unify-contacts.ts`. The phase reads two local CSVs, projects them through pure mappers (`src/lib/hubspot/*`), resolves companies, and plans persons with the existing `planIdentityWrites`. It also plans `status_backfill` and company-note activities. Execute uses the collapse/fold/catch-up gate: dry run, `/admin/migration` approval, hash check, `pg_dump`, then one transaction.

## Data Flow

    CSV (local path) ─stream─> csv-parse ─project─> HubSpotContactRow[] / HubSpotCompanyRow[]
                                                       │
       DB snapshot (company, bd, hubspot map rows,     ▼
       prefetched persons, hubspot activity keys) ─> planHubSpotImport (pure)
                                                       │  companies → contacts → identity → refill → activities
                                                       ▼
          dry run: migration_run(report, input_hash)   execute: tx{claim, lock, re-plan, re-hash, write, recompute, audit}

## Decisions

### D1 — HubSpot ID → `person_id_map` via uuid v5
- **Context**: `person_id_map.legacy_id` is `uuid`. HubSpot IDs are numeric strings. The contact-migration delta forbids a schema change to `legacy_id`.
- **Decision**: `legacyId = uuidv5(HUBSPOT_NAMESPACE, recordId)` with `legacy_table = 'hubspot_contact'`. `HUBSPOT_NAMESPACE` is a fixed constant, pinned by a test vector. The implementation is about 15 pure lines over `node:crypto` SHA-1, with no new dependency. The raw `hubspotContactId` also goes into every activity this import writes. `hubspotLegacyId(id)` is exported for forward lookups.
- **Alternatives**: (a) a `person_external_id(source, external_id text, person_id)` table. It is readable and supports reverse lookup, but it adds a migration and a second source-id map that duplicates `person_id_map`, which rollback and the readers depend on. (b) Changing `legacy_id` to `text`. That alters a primary-key column that every reader and `personIdLookupSql` use. Rejected.
- **Consequences**: Re-import is idempotent by construction: a row is either already mapped or it isn't. Reverse lookup (person → HubSpot ID) works only through activity metadata. Changing the namespace would break idempotency, and the test guards against that. Companies get no map row, because `person_id_map.person_id` references `person`. Company identity is `companyKey` + domain (D3).

### D2 — Streaming parse, in-memory projected rows
- **Context**: The files use Spanish headers and a UTF-8 BOM, and have 209 columns. Some cells are up to ~180 KB (`Associated Email`).
- **Decision**: Use the `csv-parse` stream API over `fs.createReadStream(path, "utf8")` with `bom: true`, `columns: true`, `skip_empty_lines: true`, `relax_column_count: false` (corruption fails fast), and an explicit `max_record_size: 2_000_000`. Each record is projected immediately to a typed row, so heavy unused columns are never kept. The ~9.2k projected rows stay in memory. `src/lib/hubspot/columns.ts` pins the header strings, which are read from the real export's header line. Headers are compared after `normalize("NFC").trim()`. A missing required header fails with the list of missing header names (headers are not PII). The mappers are pure and cover trimming, blank→null, integers, dates and URL normalization.
- **Alternatives**: `csv-parse/sync` over the whole file. It works, but holds every 180 KB cell for no benefit. Rejected.
- **Consequences**: Parser errors are rethrown as `Error("CSV parse failed at line N (code)")`. `CsvError` carries `raw`/`record` properties, and Node's `console.error` would print them.

### D3 — Companies: domain, then normalized name, then create
- **Context**: `company` (PK `companyKey = normalizeCompanyKey(name)`) has **no domain column**, so the spec's "domain matches an existing company" cannot be met without one. The matcher's name+company key and `person.companyKey` both come from the normalized name.
- **Decision**: Additive migration `0015_company_domain`: `company.domain text` plus a partial unique index where the domain is not null. Its journal `when` must exceed 0014's (`tests/unit/drizzleJournal.test.ts`). Resolution in `src/lib/hubspot/companies.ts` (pure):
  1. Group HubSpot companies by normalized domain (lowercase, no protocol, no `www.`, no path).
  2. Per group, look for an existing company by domain; failing that, by the `companyKey` of each name in the group; failing that, create one. The representative record is the one with the most primary contacts, with ties going to the lowest ID. A name match fills `domain` only if it is empty.
  3. Own-company groups (via `ownCompanyMatchReason`, name or domain) create nothing, and their contacts are skipped.
  4. Company rows are created only for groups that are the primary company of at least one imported contact, or that carry a note.
- **Linking**: `Associated Company IDs (Primary)` → group → `person.companyKey`/`person.company`. If the ID is absent or unresolved, fall back to the contact's own company text, counted as `noCompanyResolved`.
- **Notes**: Each non-empty `Associated Note` becomes `activity{companyKey, type:'note', actorBdId:null, metadata:{body, source:'hubspot_import', hubspotCompanyId}}`. It is skipped when one with the same `hubspotCompanyId` already exists.
- **Alternatives**: Use the domain only to dedupe within the export, with no column. The spec's domain scenario would then be unsatisfiable, and later imports could not match by domain. Rejected.
- **Consequences**: `emailSuggestion` can use the stored domains later (out of scope). Industry, country and size stay out of scope because `company` has no columns for them.

### D4 — Identity: reuse `planIdentityWrites`, extended
- **Mapper**: HubSpot rows become `IdentityIngestRow` with `legacyTable:'hubspot_contact'`, `profileKey = normalizeProfileKey(linkedin)` (≈0.6%), `emailStatus:'probable'`, `emailSource:'hubspot_import'`, and `sourceKey:'hubspot_import'`.
- **Status vocabulary**: The spec's "unverified" maps to the existing `probable` status, so the `EmailStatus` union, filters and ranks stay as they are.
- **Matcher change** (contact-identity delta, scoped to `source: 'hubspot_import'` rows only):
  - Add `IdentityIndex.byEmail(email): PersonId[]` (live persons, any status).
  - After the strong keys, an exact email match where either side is not `verified` returns `review` with the new reason `email_unverified` — but only when the incoming row's `source` is `'hubspot_import'`. Plain `contact`/`lead` rows (live ingest, catch-up) never set `source`, so this rule never fires for them; they keep matching exactly as before.
  - Prefetch gains one indexed query on `email_normalized`.
  - `buildNameCompanyKey` prefers an explicit `companyKey`, so a domain-resolved key is used for matching.
- **Resolver extensions**: optional `ownerBdId`, `company`, `city`, `country`, and `migrationRunId` on persons and map rows. `bdId` becomes nullable, with no `person_bd_connection` for HubSpot rows, because a HubSpot owner is not a LinkedIn connection. A `mergePolicy: 'r7' | 'fill_empty'` option, where HubSpot uses `fill_empty`. `company`, `companyKey`, `city` and `country` are fill-empty-only on an existing person under **both** policies — an existing non-empty value is never overwritten, regardless of `mergePolicy`; only a currently empty field is ever filled. The policy switch (`r7` specificity/recency vs. `fill_empty`) governs every other mergeable field (`firstName`, `lastName`, `jobTitle`, `industry`, `ownerBdId`, the email-field group).
- **Owner**: `normalizeNameKey(hubspotOwner) === normalizeNameKey(bd.name)`. Blank or deactivated owners (the `(Deactivated…)` suffix, pinned from the real file) are unassigned. Unknown names are unassigned, and the report counts them per owner name. BD names are not contact PII.
- **Re-import (R7/Q3)**: Rows already mapped skip the matcher. `planHubSpotRefill` fills only null/empty fields; the email fields move together and only fill when `email` is null. Every filled field writes `person_property_history(source:'import')`. A profile-key auto-match gets the same fill-empty treatment.
- **Consequences**: The `email_unverified` rule is scoped to `source: 'hubspot_import'` rows only — live CSV/lead ingest and catch-up are unaffected and never open this kind of pair. The review UI still needs a Spanish label for the reason, since HubSpot-imported rows do surface it.

### D5 — Past outreach → `status_backfill`
`src/lib/hubspot/statusEvidence.ts` (pure) emits at most one stage backfill (the highest) plus at most one discard:

| Evidence | Emits |
|---|---|
| `Número de veces contactado` > 0, `Último contacto` set, or `En curso` | `contacted` |
| `Conectado`, `Mal momento` | `replied` |
| `No calificado` | `discarded`, `reason:'wrong_profile'` |
| `Nuevo`, `Abierto`, no evidence | nothing |

- **Metadata**: `{status, reason?, originalEditorBdId: ownerBdId, originalAt, source:'hubspot_import', hubspotContactId}`.
- **`originalAt`**: `Último contacto`, then `Última actividad`, then `Fecha de creación`, parsed in the portal timezone constant. If all three fail, it uses the run time and increments `dateFallback`.
- **Discard type**: Using `status_backfill` rather than a `discarded` row keeps the historical `originalAt`. Because the discard and the stage share the same time, the discard wins in `deriveStatus`.
- **Idempotency**: The key is `(hubspotContactId, status)`, so a later export can advance a status without duplicates.
- **After the writes**: `recomputePersonStatuses(tx, touchedPersonIds)` runs in the same transaction.

### D6 — Gate and execute
- **CLI**: `--phase=hubspot_import --file=<path> --companies=<path> [--dry-run | --execute --run=<id>]`. `cliArgs` requires both paths for this phase and rejects them for other phases.
- **Guards**: `MigrationRunKind` gains `hubspot_import`. `assertExecutionAllowed` and `assertApprovable` are unchanged.
- **Input hash**: `hashRowSet` over the projected contact rows and company rows (`id` = HubSpot ID), plus the DB snapshot the planner reads: prefetched persons, existing hubspot map rows, touched companies, the bd name map, and existing hubspot activity keys. The hash covers what the planner reads, not the file bytes.
- **Execute order**:
  1. Pre-check the hash, so a stale run fails before anything else.
  2. `snapshotBackup`. `company` is added to `BACKUP_TABLES`.
  3. One transaction: claim the run → `pg_advisory_xact_lock(IDENTITY_LOCK_KEY)` as the first write-path statement → **re-prefetch and re-hash inside the lock**, aborting if the hash differs → companies → persons/map/candidates → refill → activities → status recompute → report, `executedAt`, `audit_log(migration_execute)`.
  4. Re-hashing inside the lock closes the prefetch gap that catch-up documents as a residual risk.
- **Batching**: `WRITE_BATCH_SIZE` (1000). Person inserts are about 17 columns × 1000 = 17k binds, under 65,535. Each prefetch key list is at most 5,975.
- **Operating window**: Run in a low-traffic window. The lock blocks live CSV/lead ingest for the duration of the transaction (estimated tens of seconds).
- **Rollback**:
  - Delete `person` where `migration_run_id = X`. This cascades to map rows, activities and candidates.
  - Delete the companies in `report.createdCompanyKeys`, which cascades their notes.
  - Clear the domains in `report.domainFilledCompanyKeys`.
  - Revert fills from `person_property_history`.
  - `pg_dump` is the last resort.

### D7 — Dry-run report and review threshold
`migration_run.report`:

```ts
{ rowsRead, outcomes:{new, review, profile_key, skipped_own_company, already_imported, invalid},
  review:{byReason:{email_unverified, name_company, conflicting_strong_keys}, againstExisting, withinImport},
  owners:{mapped:Record<bdName,n>, blank, deactivated, unknown:Record<ownerName,n>},
  companies:{rows, matchedByDomain, matchedByName, created, ownCompany, noCompanyResolved, notes},
  backfills:{contacted, replied, discarded}, dateFallback, refill:{persons, fields},
  reviewThreshold, overThreshold, createdCompanyKeys, domainFilledCompanyKeys,
  reviewSample: Array<{reason, incoming:{name, companyKey, emailDomain}, existing:{personId, name, companyKey}}> } // ≤20
```

- **Counts are exact**: The dry run is the full plan against the live snapshot, and the hash freezes it, so the counts are exact, not estimates.
- **Sample**: 20 pairs chosen deterministically (lowest `sha256(legacyId)`), so reruns show the same pairs. The sample shows email domains only, never local parts. The owner estimates the false-positive rate from it.
- **Threshold**: `HUBSPOT_REVIEW_THRESHOLD` is an owner-set constant. When `review` exceeds it, approving requires an explicit checkbox, "Confirmo N contactos a revisar". This is enforced in the approve action (new block reason `review_threshold_unconfirmed`).
- **Admin page**: `/admin/migration` gets an "Importación de HubSpot" section. Its labels live in `es.migration` in neutral Spanish, following `mockups/GLOSSARY.md`.

### D8 — PII
- The files are read only from a local path. `/hubspot/` is already git-ignored, and a unit test asserts it stays that way. There is no upload endpoint.
- stdout prints `redactReportForLog(report)`, which is counts only: `reviewSample` is removed and owner maps collapse to counts. The phase catches its own errors and prints a sanitized message, never raw `err` objects.
- `reviewSample` is persisted only in `migration_run.report`. It is admin-only and holds the same data the review queue already shows.
- Backups go to the git-ignored `backups/`.

## File Changes

| File | Action |
|---|---|
| `drizzle/0015_company_domain.sql`, `drizzle/meta/*`, `src/db/schema.ts` | Create/Modify: `company.domain` |
| `src/lib/hubspot/{columns,parse,contacts,companies,owners,statusEvidence,refill,planner,report,uuidv5}.ts` | Create (pure except the `parse` stream) |
| `src/lib/hubspot/importQueries.ts` | Create: snapshot reads, `finalizeHubSpotExecute` |
| `src/lib/migration/hubspotRun.ts` | Create: dry-run/execute ports (mirrors `catchUpRun.ts`) |
| `src/lib/identity/{matcher,resolve,resolveDb}.ts` | Modify: `byEmail`, `email_unverified`, nullable `bdId`, extra fields, `mergePolicy`, `migrationRunId` |
| `src/lib/migration/{cliArgs,executionGuard,inputHash,backup}.ts`, `scripts/unify-contacts.ts` | Modify |
| `src/app/(app)/admin/migration/{page,actions}.tsx`, `src/lib/i18n/dictionaries/es.ts`, `en.ts` | Modify |

## Testing Strategy

| Layer | What |
|---|---|
| Unit | uuid v5 vector; header NFC matching; the mappers; company grouping and resolution; owner matching; the status-evidence table; refill; matcher `email_unverified`; cliArgs; hash staleness; report redaction; `.gitignore` guard |
| Integration | A fixture CSV with synthetic data (BOM, a 200 KB cell, accents) → dry-run report; a second run reports 0 new |
| Manual | Dry run against the real export, reviewed in `/admin/migration` |

## Open Questions (owner)

- [ ] `HUBSPOT_REVIEW_THRESHOLD` value (proposed 300, ≈5%).
- [ ] Create companies only for those with linked contacts or a note (proposed), or all 3,230?
- [ ] Accept the `company.domain` migration (required by the spec's domain-first rule)?
- [x] Should the `email_unverified` review rule also apply to live lead ingest (the spec says every source)? Resolved: no — scoped to `source: 'hubspot_import'` only (see D4 Consequences).
- [ ] Spec wording: "unverified" is stored as `probable` with `emailSource='hubspot_import'`.
