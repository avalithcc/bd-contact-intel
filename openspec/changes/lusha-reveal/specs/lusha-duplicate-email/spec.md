# Lusha Duplicate Email Specification

## Purpose

`person.email` has no unique constraint and the identity matcher runs only at ingest, so a revealed email may already belong to another Contact. A paid reveal must not end in a wall or a silent duplicate; it must store the value and lead the BD to the existing merge flow.

## Requirements

### Requirement: A duplicate revealed email is stored and warned about

After a successful reveal the system MUST compare the normalized revealed email against other non-merged Contacts. If another Contact already holds it, the system MUST still store the value on the revealed Contact (as specified in the write path), and MUST warn the BD naming the Contact that already holds that email. The warning MUST NOT block, undo or delay the reveal.

#### Scenario: Duplicate detected

- GIVEN Contact B holds `ana@acme.com`
- WHEN a reveal on Contact A returns `Ana@Acme.com`
- THEN the email is stored on Contact A
- AND the BD sees that `ana@acme.com` already belongs to Contact B, named in the message

#### Scenario: No duplicate

- GIVEN no other Contact holds the revealed normalized email
- WHEN the reveal completes
- THEN no duplicate warning is shown

#### Scenario: Merged-away holder ignored

- GIVEN the only other holder of the email is a merged-away Contact
- WHEN the reveal completes
- THEN no duplicate warning is shown

### Requirement: The warning offers the existing merge flow

The warning MUST link the BD to the existing duplicate-review/merge flow for the two Contacts. This change MUST NOT create a new merge mechanism and MUST NOT auto-merge.

#### Scenario: Merge offered, not forced

- GIVEN a duplicate warning is shown
- WHEN the BD dismisses it
- THEN both Contacts remain unmerged with the email on both
- AND choosing the merge action opens the existing merge flow

### Requirement: The duplicate state is visible after the toast

The ledger or Contact record MUST allow the duplicate to be rediscovered later, so a dismissed warning is not lost.

#### Scenario: Warning rediscoverable

- GIVEN a duplicate warning was dismissed
- WHEN the BD reopens Contact A
- THEN the record still indicates that its Lusha-revealed email is shared with Contact B
