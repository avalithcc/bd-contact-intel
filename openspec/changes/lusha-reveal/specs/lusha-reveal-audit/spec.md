# Lusha Reveal Audit Specification

## Purpose

Every reveal leaves an auditable activity naming the BD who spent the credits. Buying a data point is not relationship work, so the activity type must never move the Contact's stage, transfer its ownership, or reset the follow-up clock. The `hunter_lookup` precedent does the wrong thing for ownership and follow-up, so activity-type semantics live in four lists, not one.

## Requirements

### Requirement: Every revealed value writes an activity naming the actor

A successful reveal MUST write an activity of a new type `lusha_reveal`, recording the actor BD, the field revealed and the Contact. The activity MUST appear in the Contact timeline in the same "Sistema" group where `hunter_lookup` appears, with its own label and entry body. The entry body MUST NOT expose the full revealed value beyond what the Contact record already displays.

#### Scenario: Activity on success

- GIVEN BD Mariel reveals an email
- WHEN the reveal settles
- THEN a `lusha_reveal` activity exists naming Mariel and the field `email`
- AND it appears in the Contact timeline

#### Scenario: No activity without a revealed value

- GIVEN a search ended in no-match or a rejected match
- WHEN the attempt settles
- THEN no `lusha_reveal` activity is written
- AND the ledger still records the attempt with the actor

### Requirement: The activity never changes derived status

`lusha_reveal` MUST be registered as status-neutral so a reveal never moves a Contact's derived stage.

#### Scenario: Stage unchanged

- GIVEN a Contact derived as `new`
- WHEN a reveal writes its activity
- THEN the derived status is still `new`

### Requirement: The activity is not a touch

`lusha_reveal` MUST be shown on the timeline but MUST NOT count as a touch for "last activity" purposes. It MUST be registered in the non-touch activity list, in line with how `call_attempt` is treated.

#### Scenario: Last activity unaffected

- GIVEN a Contact whose last touch was 20 days ago
- WHEN a reveal is performed
- THEN the Contact's last-touch value is unchanged

### Requirement: The activity never transfers ownership or resets the follow-up clock

`lusha_reveal` MUST be excluded from the activity types that count for ownership and follow-up progress (the no-progress list), like `call_attempt` and unlike `hunter_lookup`.

#### Scenario: Ownership unchanged

- GIVEN Contact A is owned by BD Cristian and BD Mariel reveals its email
- WHEN ownership is next recomputed (merge or backfill)
- THEN the Contact remains owned by Cristian

#### Scenario: Follow-up clock unchanged

- GIVEN a Contact with a follow-up due in 3 days
- WHEN a reveal is performed
- THEN the follow-up due date is unchanged

### Requirement: Spend is attributable per BD for visibility only

The ledger's actor BD MUST allow reading spend per BD. This MUST be read-only visibility and MUST NOT feed any limit.

#### Scenario: Per-BD spend readable

- GIVEN Mariel and Cristian each performed reveals
- WHEN the ledger is queried by actor
- THEN credits per BD are obtainable, and no limit is applied to either
