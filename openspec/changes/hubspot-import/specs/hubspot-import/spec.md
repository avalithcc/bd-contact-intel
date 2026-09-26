# HubSpot Import Specification

## Purpose

Define the one-time, re-runnable import of the HubSpot contacts + companies export into the unified `person` model: column mapping, owner mapping, status-evidence mapping, company matching/creation and linking, company notes, own-company skip, idempotent re-import, and the PII-safe dry-run report.

## Requirements

### Requirement: Row classification per contact

The system MUST classify every HubSpot contact row into exactly one outcome: `new` (creates a `person`), `review` (routed to the possible-duplicate review queue per contact-identity), `profile_key` (auto-matched to an existing Contact via LinkedIn profile key, per contact-identity precedence), `skipped_own_company`, or `already_imported` (the row's HubSpot record ID was imported in a prior run; on re-import only currently-empty fields are filled, per the idempotent re-import requirement).

#### Scenario: Every row maps exactly once

- GIVEN a HubSpot contacts export with N rows
- WHEN the import dry-run runs
- THEN the report accounts for exactly N rows across `new`, `review`, `profile_key`, `skipped_own_company`, and `already_imported`

#### Scenario: Profile-key auto-match is reported distinctly from a new Contact

- GIVEN a HubSpot row's normalized LinkedIn profile key matches an existing Contact
- WHEN the import dry-run runs
- THEN the row is counted as `profile_key`, not `new`

#### Scenario: Re-imported row is reported as already_imported

- GIVEN a HubSpot row's record ID was already imported in a prior run
- WHEN the import dry-run runs again on the same export
- THEN the row is counted as `already_imported`, not `new`

### Requirement: Company matching and creation

The system MUST match each HubSpot company to an existing company first by domain, then by normalized name if no domain match exists, and MUST create a new company when neither matches AND the HubSpot company is the primary company of at least one imported contact or carries a non-empty "Associated Note". A HubSpot company with no domain or name match that is neither a primary company of an imported contact nor carries a note MUST NOT create a company.

#### Scenario: Domain match links to existing company

- GIVEN a HubSpot company's domain matches an existing company's domain
- WHEN the import runs
- THEN contacts linked to that HubSpot company resolve to the existing company, no new company is created

#### Scenario: No domain or name match creates a company when it is a primary company or carries a note

- GIVEN a HubSpot company has no domain or normalized-name match among existing companies
- AND it is the primary company of at least one imported contact, or it carries a non-empty "Associated Note"
- WHEN the import runs
- THEN a new company is created from the HubSpot company record

#### Scenario: Unlinked, note-less company creates nothing

- GIVEN a HubSpot company has no domain or normalized-name match among existing companies
- AND it is not the primary company of any imported contact and carries no note
- WHEN the import runs
- THEN no company is created for that HubSpot company record

### Requirement: Company domain storage

The system MUST store a `domain` on `company` so a HubSpot company can be matched by domain per the company matching requirement.

#### Scenario: Company domain is persisted

- GIVEN a HubSpot company record with a domain
- WHEN it is matched or created during import
- THEN the resulting company row has that domain stored, available for future domain matching

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

### Requirement: Discard evidence preserves the historical date

The system MUST record a HubSpot row disqualified as `No calificado` as a `status_backfill` activity with `status: 'discarded'` and a `reason` (not a plain `discarded`-type activity), so the activity's timestamp reflects the HubSpot evidence date instead of the import run time. The record page's discard-reason display MUST read the reason from either a `discarded` activity or a `status_backfill` activity with `status: 'discarded'`.

#### Scenario: Disqualified row backfills a discard with its historical date

- GIVEN a HubSpot row has lead status `No calificado`
- WHEN the import runs
- THEN a `status_backfill` activity is written with `status: 'discarded'`, `reason: 'wrong_profile'`, and a timestamp derived from the row's HubSpot date fields, not the import run time

#### Scenario: Record page shows the discard reason for an imported row

- GIVEN a person's most recent disqualifying evidence is a `status_backfill` activity with `status: 'discarded'`
- WHEN the record page renders the discard reason
- THEN it displays that reason the same way it displays a reason from a plain `discarded` activity

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

### Requirement: Review-count threshold gate

The system MUST define a review-count threshold (`HUBSPOT_REVIEW_THRESHOLD`, 300). When the dry-run report's `review` count exceeds that threshold, the `/admin/migration` approval action MUST require the owner to explicitly confirm before the run can be executed.

#### Scenario: Approval below threshold proceeds normally

- GIVEN a `hubspot_import` dry-run report has a `review` count at or below 300
- WHEN the owner approves the run
- THEN approval succeeds without an extra confirmation step

#### Scenario: Approval above threshold requires explicit confirmation

- GIVEN a `hubspot_import` dry-run report has a `review` count above 300
- WHEN the owner attempts to approve the run without the explicit confirmation
- THEN the approval is blocked with a distinct reason
- AND approval succeeds once the owner provides the explicit confirmation

### Requirement: Export files never committed or uploaded

The HubSpot export files MUST remain local-only: excluded from git and never uploaded to any remote service by the import process.

#### Scenario: Export files are git-excluded

- GIVEN the HubSpot export files exist in the local `hubspot/` directory
- WHEN a commit is made in the repository
- THEN those export files are not included in the commit
