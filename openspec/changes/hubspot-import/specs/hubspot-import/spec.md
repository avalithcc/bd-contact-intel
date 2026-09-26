# HubSpot Import Specification

## Purpose

Define the one-time, re-runnable import of the HubSpot contacts + companies export into the unified `person` model: column mapping, owner mapping, status-evidence mapping, company matching/creation and linking, company notes, own-company skip, idempotent re-import, and the PII-safe dry-run report.

## Requirements

### Requirement: Row classification per contact

The system MUST classify every HubSpot contact row into exactly one outcome: `new` (creates a `person`), `review` (routed to the possible-duplicate review queue per contact-identity), or `skipped_own_company`.

#### Scenario: Every row maps exactly once

- GIVEN a HubSpot contacts export with N rows
- WHEN the import dry-run runs
- THEN the report accounts for exactly N rows across `new`, `review`, and `skipped_own_company`

### Requirement: Company matching and creation

The system MUST match each HubSpot company to an existing company first by domain, then by normalized name if no domain match exists, and MUST create a new company when neither matches.

#### Scenario: Domain match links to existing company

- GIVEN a HubSpot company's domain matches an existing company's domain
- WHEN the import runs
- THEN contacts linked to that HubSpot company resolve to the existing company, no new company is created

#### Scenario: No domain or name match creates a company

- GIVEN a HubSpot company has no domain or normalized-name match among existing companies
- WHEN the import runs
- THEN a new company is created from the HubSpot company record

### Requirement: Contact-to-company linking

The system MUST link an imported contact to a company using the contact's "Associated Company IDs (Primary)" HubSpot column resolved through company matching.

#### Scenario: Primary company link resolves

- GIVEN a contact row has an "Associated Company IDs (Primary)" value
- WHEN the import runs
- THEN the resulting `person` is linked to the company resolved from that HubSpot company ID

### Requirement: Company notes become company-level activities

The system MUST import each non-empty HubSpot company "Associated Note" as a company-level note activity, not attached to any individual contact.

#### Scenario: Company note imports as a company activity

- GIVEN a HubSpot company has a non-empty "Associated Note"
- WHEN the import runs
- THEN a note activity is created on that company, unattached to any contact

### Requirement: Owner mapping

The system MUST map HubSpot owners to BDs by exact or accent-insensitive name match (e.g., "Macarena Davila" matches BD "Macarena Dávila"), and MUST leave a contact unassigned when the HubSpot owner is deactivated or blank.

#### Scenario: Accent-insensitive owner match

- GIVEN a HubSpot row's owner is "Macarena Davila"
- WHEN owner mapping runs
- THEN the resulting `person` owner is BD "Macarena Dávila"

#### Scenario: Deactivated or blank owner is unassigned

- GIVEN a HubSpot row's owner is deactivated or blank
- WHEN owner mapping runs
- THEN the resulting `person` has no owner assigned

### Requirement: Status-evidence backfill activities

The system MUST write a `status_backfill` activity for each imported contact whose HubSpot fields indicate prior outreach, using only existing R4 statuses, per the resolved mapping (contact count/last-contact/lead-status fields).

#### Scenario: Contacted evidence produces a status_backfill activity

- GIVEN a HubSpot row has `Número de veces contactado` > 0 or a non-empty `Último contacto`
- WHEN the import runs
- THEN a `status_backfill` activity is written and the derived status is `contacted`

#### Scenario: No outreach evidence writes no activity

- GIVEN a HubSpot row's lead status is `Nuevo` with no contact evidence
- WHEN the import runs
- THEN no `status_backfill` activity is written for that row

### Requirement: Own-company skip

The system MUST skip creating a `person` for any HubSpot row whose resolved company is the own company, and MUST count it as `skipped_own_company` in the report.

#### Scenario: Own-company row is skipped

- GIVEN a HubSpot row resolves to the own company
- WHEN the import runs
- THEN no `person` is created for that row
- AND the row is counted as `skipped_own_company`

### Requirement: Idempotent re-import

The system MUST store each imported contact's HubSpot record ID so that re-running the import never creates a duplicate `person` for the same HubSpot contact, and MUST only fill currently empty fields on re-import, never overwriting values already edited in the app.

#### Scenario: Re-import creates zero new persons

- GIVEN an import has already run for a HubSpot export
- WHEN the same export is imported again
- THEN zero new `person` rows are created

#### Scenario: Re-import does not overwrite an edited field

- GIVEN a previously imported `person` has a field value edited in the app after import
- WHEN the same HubSpot row is re-imported
- THEN that field's value is unchanged
- AND only fields still empty are filled from the HubSpot row

### Requirement: PII-safe dry-run report

The system MUST produce a dry-run report before any production execution, with counts by classification and mapping method, and MUST NOT print or persist raw contact PII (names, emails, phone numbers) in logs or reports beyond an owner-reviewed sample.

#### Scenario: Dry-run report shows counts only

- GIVEN the dry-run completes
- WHEN the report is generated
- THEN it lists counts per classification and per matching method
- AND it does not print raw PII values outside the owner-reviewed sample

### Requirement: Export files never committed or uploaded

The HubSpot export files MUST remain local-only: excluded from git and never uploaded to any remote service by the import process.

#### Scenario: Export files are git-excluded

- GIVEN the HubSpot export files exist in the local `hubspot/` directory
- WHEN a commit is made in the repository
- THEN those export files are not included in the commit
