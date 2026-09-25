# Contact Migration Specification

## Purpose

Define the collapse/fold backfill that produces the unified Contact model from legacy `contact` and `lead` rows, the old-id to new-id mapping, the dry-run report gate, and rollback.

## Requirements

### Requirement: Dry-run report before production execution

Every migration or merge run MUST first execute as a dry-run producing a report (auto-merged / flagged for review / new counts, per affected table) reviewed by the owner before any non-dry-run execution against production data.

#### Scenario: Dry-run blocks production execution until reviewed

- GIVEN a migration slice has not yet had its dry-run report reviewed by the owner
- WHEN the production run is requested
- THEN it does not execute

#### Scenario: Dry-run report shows counts per table

- GIVEN the dry-run completes
- WHEN the report is generated
- THEN it lists auto-merged, flagged-for-review, and new counts broken down per affected table

### Requirement: Collapse duplicate `contact` rows

The system MUST collapse `contact` rows sharing a normalized LinkedIn profile key into one Contact, dropping `bdId` from identity, and MUST derive the list of connected BDs with each BD's own `connectedOn` date.

#### Scenario: Same profile key across 3 BDs collapses to one Contact

- GIVEN 3 `contact` rows share the same normalized LinkedIn profile key under 3 different BDs
- WHEN the collapse step runs
- THEN one Contact is created
- AND all 3 BDs appear as connected BDs with their individual `connectedOn` dates preserved

### Requirement: Fold `lead` rows via the matcher

The system MUST fold `lead` rows into the unified Contact set using the identity matcher (contact-identity spec), carrying source provenance and `ownerBdId` for unmatched leads that become new Contacts.

#### Scenario: Lead matching an existing collapsed Contact folds in

- GIVEN a lead matches an existing collapsed Contact via LinkedIn profile key
- WHEN the fold step runs
- THEN the lead's notes, status-supporting activity, and source are merged into that Contact

Note: the `lead` table carries no LinkedIn profile key column, so in practice a lead can only match an existing Contact via verified email or the name+company fallback — never via profile key (see `foldPlanner.ts`).

### Requirement: Reference migration via id mapping

The system MUST migrate `activity`, `task`, `signal`, and `linkedinScrapeJob` references from legacy `contactId`/`leadId` to the unified Contact id through an old-id to new-id mapping table, leaving zero orphaned references.

#### Scenario: Every legacy id resolves to a Contact

- GIVEN the mapping table is populated
- WHEN any legacy `contact` or `lead` id is looked up
- THEN it resolves to exactly one Contact via the mapping table

### Requirement: Backfill activity for manually set status

For leads with a manually set status and no supporting activity, the migration MUST write a backfilled activity ("status recorded before migration", with the original editor and timestamp) so the derived status is preserved with evidence.

#### Scenario: Manually set "meeting" status gets a backfilled activity

- GIVEN a lead's status was manually set to `meeting` with no logged meeting activity
- WHEN the migration runs
- THEN a backfilled activity is written recording the original editor and timestamp
- AND the resulting Contact's derived status remains `meeting`

### Requirement: Additive rollback

Migration slices MUST write new Contact tables and the id mapping additively, alongside legacy `contact`/`lead` tables, which MUST remain read-only until verification. Rollback MUST be possible by pointing reads back to legacy tables and dropping the new rows.

#### Scenario: Rollback after a failed verification

- GIVEN a migration slice has run but verification fails
- WHEN rollback is executed
- THEN reads point back to the legacy `contact`/`lead` tables
- AND the newly written Contact rows are dropped

### Requirement: Incremental catch-up run

The system MUST provide a catch-up run that processes only legacy rows absent from `person_id_map`, plus references with a null `person_id`. It is gated like every migration run.

#### Scenario: Only unmapped rows are processed

- GIVEN 19,685 mapped contacts and 40 contacts created after the collapse run
- WHEN the catch-up dry-run executes
- THEN the report covers exactly the 40 unmapped contacts

#### Scenario: Re-run is a no-op

- GIVEN a catch-up run has executed
- WHEN another catch-up dry-run executes with no new writes
- THEN it reports zero rows

### Requirement: Additive rollback (MODIFIED)

Migration runs MUST NOT write legacy `contact`/`lead` rows. Live write paths MUST continue writing legacy tables (dual-write) until the read cutover is verified, so rollback can point reads back to legacy tables without data loss.

