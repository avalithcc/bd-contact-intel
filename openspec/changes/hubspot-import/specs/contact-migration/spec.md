# Delta for Contact Migration

## ADDED Requirements

### Requirement: HubSpot import migration kind

The system MUST provide a `hubspot_import` migration run kind, gated the same as every other migration run: dry-run report first, then owner approval in `/admin/migration`, then a guarded execute that records an input hash, takes a `pg_dump` backup, and writes an `audit_log` entry.

#### Scenario: Hubspot import execute requires prior dry-run approval

- GIVEN a `hubspot_import` dry-run report has not been reviewed by the owner
- WHEN a `hubspot_import` execute is requested
- THEN it does not execute

#### Scenario: Approved execute records hash, backup, and audit entry

- GIVEN the owner has approved a `hubspot_import` dry-run report
- WHEN the execute runs
- THEN it records the input hash, takes a `pg_dump` backup, and writes an `audit_log` entry

### Requirement: External non-uuid legacy id mapping

The system MUST map HubSpot record IDs (non-uuid external identifiers) into `person_id_map` without requiring a schema change to the `legacy_id` uuid column, using a deterministic derivation scoped to a distinct `legacy_table` value for HubSpot-sourced rows.

#### Scenario: HubSpot contact id maps deterministically

- GIVEN a HubSpot contact record ID
- WHEN it is mapped into `person_id_map`
- THEN the same HubSpot record ID always produces the same mapped id
- AND the mapping is scoped under a `legacy_table` value distinct from other legacy sources
