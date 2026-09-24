# Duplicate Review Specification

## Purpose

Define the admin-only possible-duplicate review queue and its three resolution paths: merge, not-a-duplicate, and unmerge.

## Requirements

### Requirement: Admin-only queue

Only admins MUST be able to resolve entries in the possible-duplicate review queue. Non-admins MUST NOT see resolution controls.

#### Scenario: Non-admin cannot resolve a queue entry

- GIVEN a BD without the admin role opens the review queue
- WHEN they attempt to merge or dismiss an entry
- THEN the action is rejected

### Requirement: Name+company matches route to the queue

Every name+company match produced by the identity matcher MUST land in the review queue and MUST NOT auto-merge.

#### Scenario: Weak match appears in the queue

- GIVEN a new row matches an existing Contact only on normalized name+company
- WHEN the matcher runs
- THEN the pair appears in the review queue for an admin to resolve

### Requirement: Merge path

An admin MUST be able to merge a queue entry, which applies the contact-identity property conflict rules and records the merge in the merge audit trail.

#### Scenario: Admin merges a true duplicate

- GIVEN a queue entry represents the same real person
- WHEN the admin selects "merge"
- THEN the two records are combined into one Contact
- AND the merge is recorded in the merge audit trail

### Requirement: Not-a-duplicate path

An admin MUST be able to mark a queue entry as "not a duplicate". Once marked, the system MUST NOT resurface that specific pair in the queue again.

#### Scenario: Suppressed pair does not resurface

- GIVEN an admin marks a pair as "not a duplicate"
- WHEN the matcher next runs over the same two records
- THEN the pair does not reappear in the review queue

### Requirement: Unmerge path, admin-only, no time limit

An admin MUST be able to unmerge a previously merged pair at any time, with no time window restriction, restoring both records from the merge audit trail.

#### Scenario: Admin unmerges a false merge

- GIVEN an admin previously merged two records that turn out to be different people
- WHEN the admin selects "unmerge" on that Contact
- THEN both original records are restored from the merge audit trail
- AND the false-merge Contact no longer exists as a single combined record

#### Scenario: Unmerge available regardless of merge age

- GIVEN a merge happened months ago
- WHEN an admin requests unmerge
- THEN the system does not block the action due to elapsed time
</content>
</invoke>
