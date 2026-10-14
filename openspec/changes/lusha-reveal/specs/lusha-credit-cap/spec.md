# Lusha Credit Cap Specification

## Purpose

Bound how many Lusha credits the whole team can spend per day, so a day of clicking cannot empty the account. The cap is global, denominated in credits, computed from the application's own ledger, and configured in exactly one place.

## Requirements

### Requirement: One global daily cap, denominated in credits

The system MUST enforce a single global ceiling on credits charged per business day, default 12 credits while the account is the free 40-credit pool. The system MUST NOT enforce any per-BD cap; the actor is recorded for visibility only. The ceiling MUST be defined in one configurable place, so raising it when the account goes paid requires one change.

#### Scenario: Default ceiling

- GIVEN no override is configured
- WHEN the cap is evaluated
- THEN the daily ceiling is 12 credits

#### Scenario: No per-BD split

- GIVEN BD Mariel has used 10 of 12 credits today and BD Cristian has used 0
- WHEN Cristian requests a 2-credit reveal
- THEN it is allowed, because the global total (10 + 2) does not exceed 12

#### Scenario: Raising the ceiling is a single change

- GIVEN the owner raises the configured ceiling
- WHEN the next reveal is evaluated
- THEN the new ceiling applies everywhere with no other change

### Requirement: Credits used are computed from our ledger, never from Lusha

The credits used today MUST be the sum of credits charged recorded in the `lusha_reveal` ledger for the current business day. The system MUST NOT use `GET /v3/account/usage` to decide whether a reveal is allowed, because that endpoint is eventually consistent and can report a stale balance right after a charge.

#### Scenario: Stale Lusha balance is ignored

- GIVEN a charge was just recorded in the ledger and Lusha usage still shows the old balance
- WHEN another reveal is evaluated
- THEN the decision uses the ledger total including the just-recorded charge

### Requirement: The cap is checked before the call, using the expected cost

Before any Lusha request the system MUST compute the action's expected cost (search plus field price when no stored search exists; the stored field price otherwise) and MUST refuse the action when used credits plus expected cost would exceed the ceiling. The refusal MUST happen before any network call.

#### Scenario: Cap boundary

- GIVEN 11 of 12 credits are used today
- WHEN a BD requests a first email reveal (expected 2 credits)
- THEN it is refused before any Lusha call and nothing is charged

#### Scenario: Exactly at the ceiling is allowed

- GIVEN 10 of 12 credits are used today
- WHEN a BD requests a first email reveal (expected 2 credits)
- THEN it is allowed

#### Scenario: Phone does not fit

- GIVEN 8 of 12 credits are used today and the Contact has no stored search
- WHEN a BD requests a phone reveal (expected 6 credits)
- THEN it is refused before any Lusha call

### Requirement: The BD sees why the cap blocked them

When the cap blocks an action the control MUST be disabled or refuse with explicit copy stating that the team's daily Lusha credit limit is reached and that it resets the next business day. The confirmation dialog MUST show the credits remaining today.

#### Scenario: Cap exhausted

- GIVEN the day's credits are exhausted
- WHEN a BD opens a Contact with an eligible reveal
- THEN the control is disabled with copy that the daily Lusha limit is reached and resets tomorrow
- AND the copy is distinct from the account-out-of-credits (402) copy

#### Scenario: Remaining shown in the dialog

- GIVEN 5 of 12 credits are used today
- WHEN a BD opens a reveal dialog
- THEN it states 7 credits remaining today

### Requirement: "Per day" uses the application's business timezone

The day boundary MUST be the app's existing business timezone, not UTC and not Lusha's own reset time.

#### Scenario: Boundary

- GIVEN a charge recorded at 23:30 business time and another at 00:30 business time
- WHEN daily usage is computed at 01:00
- THEN only the 00:30 charge counts toward the new day

### Requirement: The cap uses billed credits

Credits counted MUST be the credits Lusha reports billed for each search and reveal, including a search charge when the reveal then fails. A reveal that returns nothing and bills 0 MUST count as 0.

#### Scenario: Paid search, failed reveal

- GIVEN a search billed 1 credit and the reveal then failed with a transient error billing 0
- WHEN daily usage is computed
- THEN 1 credit is counted
