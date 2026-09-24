# Contact Identity Specification

## Purpose

Define the unified Contact model, the matcher precedence used to fold `contact` and `lead` rows into one record per real person, and the property conflict/history rules applied on merge. Reusable by any future ingestion source (scraping, purchased data).

## Requirements

### Requirement: One Contact per real person

The system MUST represent each real person as exactly one Contact record, shared team-wide, with a single `owner` property. The system MUST NOT create private per-BD copies of a Contact.

#### Scenario: Person known to 3 BDs and a lead collapses to one Contact

- GIVEN a person exists as a LinkedIn `contact` for 3 different BDs and also as a `lead`
- WHEN identity matching runs
- THEN exactly one Contact is created for that person
- AND all 3 BDs are recorded as connected BDs with their own `connectedOn` dates
- AND the lead's notes, status-supporting activity, and source are preserved on that Contact

### Requirement: Matcher precedence

The system MUST resolve identity using, in order: (1) normalized LinkedIn profile key match → auto-merge; (2) exact email match where both sides are `verified` → auto-merge; (3) normalized name+company match → route to the possible-duplicate review queue, never auto-merge; (4) otherwise → create a new Contact. The system MUST apply this same precedence to any future ingestion source.

#### Scenario: LinkedIn profile key match auto-merges

- GIVEN an incoming row has a normalized LinkedIn profile key matching an existing Contact
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

#### Scenario: Verified-email match auto-merges

- GIVEN an incoming row has an email exactly matching an existing Contact's email, and both are marked `verified`
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

#### Scenario: Name+company match never auto-merges

- GIVEN an incoming row matches an existing Contact only on normalized name and company
- WHEN the matcher runs
- THEN the row is placed in the possible-duplicate review queue
- AND no automatic merge occurs

#### Scenario: Lead without email or LinkedIn falls back to name+company

- GIVEN a lead has no email and no LinkedIn profile
- WHEN the matcher runs
- THEN only normalized name+company matching is attempted
- AND the result is either a review-queue entry or a new Contact, never an auto-merge

### Requirement: Conflicting strong-key matches are never auto-merged

The system MUST NOT auto-merge when an incoming row's normalized LinkedIn profile key and verified email each match a DIFFERENT existing Contact. Such rows MUST be placed in the possible-duplicate review queue referencing both candidate Contacts instead. When the profile key and verified email agree on the same Contact, the row auto-merges as normal.

#### Scenario: Profile key and verified email disagree on different Contacts

- GIVEN an incoming row's normalized LinkedIn profile key matches Contact A
- AND the row's verified email matches a different Contact B
- WHEN the matcher runs
- THEN the row is placed in the possible-duplicate review queue referencing both Contact A and Contact B
- AND no automatic merge occurs

#### Scenario: Profile key and verified email agree on the same Contact

- GIVEN an incoming row's normalized LinkedIn profile key and verified email both match the same existing Contact
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

### Requirement: Owner assignment on merge

The system MUST set the Contact `owner` to the BD with the earliest `connectedOn` LinkedIn connection among the merged rows. If no row has a LinkedIn connection, the system MUST keep the lead's existing owner.

#### Scenario: Earliest connector becomes owner

- GIVEN a person is a LinkedIn connection of 3 BDs with different `connectedOn` dates and also a lead
- WHEN the merge completes
- THEN the owner is the BD with the earliest `connectedOn` date

#### Scenario: No LinkedIn connection keeps the lead owner

- GIVEN a lead has no matching LinkedIn `contact` row
- WHEN the Contact is created from that lead
- THEN the owner remains the lead's existing `ownerBdId`

### Requirement: Property conflict and history rules

The system MUST keep one current value per property with change history recording who last updated it. On merge, the system MUST prefer the richer/more specific value, then the most recent non-null value; losing values MUST be recorded in the merge audit trail. Notes MUST append with attribution rather than overwrite. `connectedOn` MUST be kept per BD, not collapsed into a single value.

#### Scenario: Richer value wins on merge

- GIVEN two merged rows have different values for the same property, one more specific than the other
- WHEN the merge resolves the conflict
- THEN the more specific value becomes current
- AND the other value is recorded in the merge audit trail

#### Scenario: Notes append instead of overwrite

- GIVEN two merged rows each have notes from different BDs
- WHEN the merge completes
- THEN both notes appear on the Contact, each attributed to its author

### Requirement: Own-company exclusion preserved

The system MUST exclude Contacts whose company is the own company (per `src/lib/ownCompany.ts`) from BD-facing lists and views, before and after any merge.

#### Scenario: Own-company person stays excluded after merge

- GIVEN a person works at the own company and is connected to multiple BDs
- WHEN their rows are merged into one Contact
- THEN that Contact remains excluded from contact lists and outreach views
</content>
</invoke>
