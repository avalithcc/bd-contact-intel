# Delta for Contact Identity

## MODIFIED Requirements

### Requirement: Matcher precedence

The system MUST resolve identity using, in order: (1) normalized LinkedIn profile key match → auto-merge; (2) exact email match where both sides are `verified` → auto-merge; (3) for rows sourced from `hubspot_import`, an exact email match where at least one side is not `verified` (i.e. `probable` or `none`) → route to the possible-duplicate review queue, never auto-merge; (4) normalized name+company match → route to the possible-duplicate review queue, never auto-merge; (5) otherwise → create a new Contact. Rule (3) applies ONLY when the incoming row's source is `hubspot_import`; live lead ingest and the `catch_up` migration phase are unchanged and do not apply rule (3).
(Previously: exact email match required both sides `verified` to auto-merge; there was no distinct not-verified-email rule, so a not-verified-email row fell through to name+company or new-Contact.)

#### Scenario: LinkedIn profile key match auto-merges

- GIVEN an incoming row has a normalized LinkedIn profile key matching an existing Contact
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

#### Scenario: Verified-email match auto-merges

- GIVEN an incoming row has an email exactly matching an existing Contact's email, and both are marked `verified`
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

#### Scenario: Not-verified-side exact email match routes to review for hubspot_import rows

- GIVEN an incoming row sourced from `hubspot_import` has an email exactly matching an existing Contact's email
- AND at least one of the two sides is marked `probable` or `none` (not `verified`)
- WHEN the matcher runs
- THEN the row is placed in the possible-duplicate review queue referencing that Contact, with reason `email_unverified`
- AND no automatic merge occurs

#### Scenario: Not-verified-side exact email match from other sources is unaffected

- GIVEN an incoming row sourced from live lead ingest or the `catch_up` migration phase has an email exactly matching an existing Contact's email
- AND at least one of the two sides is marked `probable` or `none`
- WHEN the matcher runs
- THEN rule (3) does not apply, and the row falls through to name+company matching or a new Contact, per prior behavior

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

### Requirement: HubSpot emails are stored as probable

Emails imported from the HubSpot export MUST be stored with `emailStatus: 'probable'` and `emailSource: 'hubspot_import'`, since HubSpot performs no email verification of its own and the app's `EmailStatus` union is `verified | probable | none`.

#### Scenario: Imported email is marked probable

- GIVEN a HubSpot row carries an email address
- WHEN the row is imported
- THEN the resulting Contact email is stored with `emailStatus: 'probable'` and `emailSource: 'hubspot_import'`
