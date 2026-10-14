# Lusha Reveal Ledger Specification

## Purpose

Define the `lusha_reveal` ledger as the single source of truth for what was searched, revealed, charged and by whom. It is simultaneously the never-pay-twice cache, the input to the daily cap, and the spend audit trail. The ledger MUST be consulted before any Lusha call.

## Requirements

### Requirement: The ledger records every paid or attempted Lusha interaction

For each Contact the ledger MUST record the Lusha search result (Lusha contact id, the matched identity, and each `canReveal` field with its price), and for each revealed field the value, the actor BD, the credits charged, the outcome and a timestamp. The no-match case MUST be recorded with the same fidelity as a successful reveal. Credits recorded MUST be the amount Lusha reports as billed, never a locally hardcoded price.

#### Scenario: Successful email reveal is recorded

- GIVEN BD Mariel reveals a Contact's email and Lusha bills 2 credits (search plus reveal)
- WHEN the attempt settles
- THEN the ledger holds the Contact, the field, the value, Mariel as actor, 2 credits in total across its search and reveal charges, the outcome and the timestamp

#### Scenario: No-match is recorded

- GIVEN a search that returns no usable Lusha contact
- WHEN the attempt settles
- THEN the ledger records the Contact with a no-match outcome and the credits billed (including 0 where Lusha billed nothing)

### Requirement: A search is never paid twice for the same Contact, except by explicit re-search after a rejected match

Once a search result is stored for a Contact, the system MUST NOT call Lusha search for that Contact again, regardless of field, outcome or elapsed time. The only exception is the explicit manual "buscar de nuevo" action available after the BD rejected the matched identity; it pays a new search credit, and the newest search result supersedes the earlier one while earlier searches and rejections remain in the ledger as history. A rejected match MUST NOT be a terminal ledger state (only a compliance block is, see below). A second field (for example phone after email) MUST reuse the stored Lusha contact id and pay only its own reveal price.

#### Scenario: Phone after email reuses the search

- GIVEN a Contact whose email reveal stored a search result
- WHEN the BD confirms the phone reveal
- THEN no search request is sent
- AND only the phone reveal is charged (5 credits)

#### Scenario: Explicit re-search after rejection is the only second search

- GIVEN a Contact whose match was rejected
- WHEN the BD confirms "buscar de nuevo"
- THEN a new search is sent, its credit is recorded, and the prior search and rejection remain as history

#### Scenario: Retry after a failure does not re-search

- GIVEN a search was paid and stored but the reveal then failed transiently
- WHEN the BD tries the reveal again
- THEN the stored Lusha contact id is reused and no new search credit is charged

### Requirement: A revealed value is never paid twice

If the ledger already holds a revealed value for a Contact and field, the system MUST serve it from the ledger and MUST NOT call Lusha. The system MUST NOT refresh or re-reveal a stored value.

#### Scenario: Second reveal of the same field

- GIVEN a Contact's email was already revealed
- WHEN a reveal for the same Contact and field is requested again
- THEN no Lusha request is made and no credits are charged

### Requirement: A known "Lusha has no email" stops the offer

When the stored search shows a field is not revealable for the Contact (not present in `canReveal`), or a reveal for it returned nothing, the system MUST persist that fact and the UI MUST stop offering a spend for that field, rendering it as unavailable ("Lusha has no email for this contact"). The control MUST NOT be clickable.

#### Scenario: Search shows no email

- GIVEN a stored search whose `canReveal` lists phones but not emails
- WHEN the About pane renders
- THEN the email control reads that Lusha has no email for this contact and is disabled
- AND the phone control remains offered at its stored price

#### Scenario: Known no-match is never re-queried

- GIVEN the ledger holds a no-match for a Contact
- WHEN any reveal is requested for it
- THEN no Lusha request is made

### Requirement: Stored prices drive the offer

When a stored search exists, the control and dialog MUST use the stored per-field price. A stored price of 0 credits (Lusha reports the account already revealed that field) MUST be shown as free and MUST NOT count against the cap beyond the credits Lusha actually bills.

#### Scenario: Price known before the click

- GIVEN a stored search with `[{field:"emails",credits:1},{field:"phones",credits:5}]`
- WHEN the BD opens either dialog
- THEN the dialog shows 1 credit for email and 5 for phone, with no search charge

### Requirement: A transient failure releases the claim; a definitive answer keeps it

The system MUST claim the Contact and field in the ledger before calling Lusha. If the call fails transiently (429, 5xx, timeout, `ENRICH_FAILED`), the claim MUST be released so the BD can try again manually, while the credits reserved for that attempt MUST keep counting against the day's cap until the real charge is known — the cap sums `coalesce(credits_charged, credits_reserved)` — because Lusha may have billed an attempt whose outcome we never read. Releasing the claim and releasing the budget are different things, and over-counting the budget is the safe direction (design D8). A no-match MUST persist and MUST NOT be released. A compliance block (451 / `COMPLIANCE_RESTRICTED`) is the only permanent state: it MUST persist and MUST NOT be retried, including by "buscar de nuevo". A rejected match persists as a record but is not permanent.

#### Scenario: Transient failure is retryable by the BD

- GIVEN a reveal fails with 429
- WHEN the failure settles
- THEN the claim is released and the control is offered again
- AND the system did not retry on its own
