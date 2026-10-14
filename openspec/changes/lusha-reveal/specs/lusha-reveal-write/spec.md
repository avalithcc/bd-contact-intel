# Lusha Reveal Write Path Specification

## Purpose

Define how a revealed value reaches the Contact so that a revealed email is immediately Sequence-eligible. The existing manual property edit writes `emailStatus = 'none'` and `emailSource = 'manual'`, which `isReachable` (`src/lib/sequences/rosterGuards.ts`) rejects, so the reveal needs its own dedicated write path.

## Requirements

### Requirement: A revealed email is stored as probable, source lusha

The system MUST write a revealed email with `emailStatus = 'probable'` and `emailSource = 'lusha'`, set the normalized email, and store Lusha's per-email confidence. It MUST NOT use `verified`, MUST NOT introduce a new status value, and MUST NOT go through the manual property-edit path. A property history row MUST record the change with a `lusha_reveal` source.

#### Scenario: Revealed email passes the Sequence gate

- GIVEN a Contact with no email and not merged
- WHEN a Lusha email reveal succeeds
- THEN the Contact has the email, `emailStatus = 'probable'`, `emailSource = 'lusha'`
- AND `isReachable` returns true for that Contact

#### Scenario: Manual path is not used

- GIVEN a successful reveal
- WHEN the write completes
- THEN the Contact's `emailStatus` is not `none` and `emailSource` is not `manual`

#### Scenario: Provenance in history

- GIVEN a successful email reveal
- WHEN property history is read
- THEN a row exists for the email change with source `lusha_reveal`

### Requirement: A revealed email replaces a non-reachable email

When the Contact holds an email that is empty, `none`, or `pattern_inferred`, a revealed email MUST replace it, and the previous value MUST remain in property history. A reachable email MUST NOT be replaced (the reveal is not offered, see the reveal action spec).

#### Scenario: Replaces pattern-inferred

- GIVEN a Contact with `emailSource = 'pattern_inferred'`
- WHEN a Lusha email reveal succeeds
- THEN the stored email is the revealed one with source `lusha`
- AND the old value is retained in property history

### Requirement: A deterministic rule selects among multiple returned values

When Lusha returns more than one email or phone, the system MUST apply a deterministic selection rule (highest confidence first, ties by Lusha's returned order) rather than silently taking an arbitrary element, and MUST store the selected value only.

#### Scenario: Highest confidence chosen

- GIVEN Lusha returns two emails with confidence 60 and 90
- WHEN the reveal is written
- THEN the 90-confidence email is stored

### Requirement: A revealed phone never overwrites an existing phone

A revealed phone MUST be written only to an empty phone field. The ledger is the record that the phone came from Lusha, and the Lusha badge MUST be shown on it.

#### Scenario: Phone written to empty field

- GIVEN a Contact with no phone
- WHEN a Lusha phone reveal succeeds
- THEN the phone is stored and the value shows the Lusha badge

#### Scenario: Existing phone protected

- GIVEN a Contact with an existing phone
- WHEN the About pane renders
- THEN no phone reveal is offered

### Requirement: Value, activity and ledger settle atomically

The Contact write, the property history row, the activity and the ledger settlement MUST succeed or fail together. A failure after Lusha has charged MUST NOT lose the paid value: the revealed value MUST remain in the ledger so it is not paid for again.

#### Scenario: Write fails after charge

- GIVEN Lusha charged and returned an email but the Contact write failed
- WHEN the BD retries
- THEN the value is served from the ledger without a new Lusha call
