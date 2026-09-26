# Delta for Contact Identity

## MODIFIED Requirements

### Requirement: Matcher precedence

The system MUST resolve identity using, in order: (1) normalized LinkedIn profile key match → auto-merge; (2) exact email match where both sides are `verified` → auto-merge; (3) exact email match where at least one side is `unverified` → route to the possible-duplicate review queue, never auto-merge; (4) normalized name+company match → route to the possible-duplicate review queue, never auto-merge; (5) otherwise → create a new Contact. The system MUST apply this same precedence to any future ingestion source.
(Previously: exact email match required both sides `verified` to auto-merge; there was no distinct unverified-email rule, so an unverified-email row fell through to name+company or new-Contact.)

#### Scenario: LinkedIn profile key match auto-merges

- GIVEN an incoming row has a normalized LinkedIn profile key matching an existing Contact
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

#### Scenario: Verified-email match auto-merges

- GIVEN an incoming row has an email exactly matching an existing Contact's email, and both are marked `verified`
- WHEN the matcher runs
- THEN the row is auto-merged into that Contact without review

#### Scenario: Unverified-side exact email match routes to review

- GIVEN an incoming row's email exactly matches an existing Contact's email
- AND at least one of the two sides is marked `unverified`
- WHEN the matcher runs
- THEN the row is placed in the possible-duplicate review queue referencing that Contact
- AND no automatic merge occurs

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

### Requirement: HubSpot emails are stored as unverified

Emails imported from the HubSpot export MUST be stored with `unverified` status, since HubSpot performs no email verification of its own.

#### Scenario: Imported email is marked unverified

- GIVEN a HubSpot row carries an email address
- WHEN the row is imported
- THEN the resulting Contact email is stored with `unverified` status
