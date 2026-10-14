# Lusha Error Handling Specification

## Purpose

Lusha failures are either account-wide conditions, plan conditions, or per-contact outcomes. Each must read as what it is, in BD-facing copy, and none may be retried automatically because a retry on a paid endpoint is a second charge.

## Requirements

### Requirement: Every error maps to a distinct, typed outcome

The system MUST map each of the following to its own error key and distinct BD-facing copy (es and en dictionaries): HTTP 401, 402, 403, 429, 451, and the per-contact outcomes `NOT_FOUND`, `COMPLIANCE_RESTRICTED`, `ENRICH_FAILED`. The server action MUST return a typed `{ ok: false, reason }` result.

#### Scenario: 401 bad key

- GIVEN Lusha responds 401
- WHEN the attempt settles
- THEN the BD sees copy that Lusha is misconfigured and the claim is released

#### Scenario: 402 no credits

- GIVEN Lusha responds 402
- WHEN the attempt settles
- THEN the BD sees that the Lusha account is out of credits
- AND the copy differs from the daily-cap-reached copy
- AND nothing is recorded as a no-match

#### Scenario: 403 plan or access

- GIVEN Lusha responds 403
- WHEN the attempt settles
- THEN the BD sees that the plan or API access does not allow this request

#### Scenario: 429 rate limit

- GIVEN Lusha responds 429
- WHEN the attempt settles
- THEN the BD sees a rate-limit message to try again later
- AND the claim is released

### Requirement: Nothing is retried automatically

The system MUST NOT retry any Lusha request automatically on any error. A retry MUST be an explicit new BD action that passes the cap and ledger checks again.

#### Scenario: No automatic retry

- GIVEN Lusha responds 429 or a 5xx
- WHEN the failure is handled
- THEN exactly one request was sent for that attempt

### Requirement: A compliance block is permanent and reads as such

A 451 or `COMPLIANCE_RESTRICTED` outcome MUST be shown as "this person cannot be revealed", MUST be persisted in the ledger as a permanent block for that Contact and field, and the control MUST NOT be offered again. It MUST NOT read as a transient failure.

#### Scenario: 451 GDPR block

- GIVEN Lusha responds 451 for a Contact
- WHEN the attempt settles
- THEN the BD sees that this person cannot be revealed
- AND the control is unavailable on later renders with no further requests

#### Scenario: COMPLIANCE_RESTRICTED inside a 200

- GIVEN Lusha returns 200 with a `COMPLIANCE_RESTRICTED` outcome for the Contact
- WHEN the attempt settles
- THEN it is handled as the same permanent block

### Requirement: Per-contact NOT_FOUND is a free, persisted no-match

A `NOT_FOUND` outcome MUST be treated as a no-match: persisted, billing 0 credits when Lusha bills 0, and never re-queried.

#### Scenario: NOT_FOUND

- GIVEN Lusha returns `NOT_FOUND` for the Contact
- WHEN the attempt settles
- THEN the ledger holds a no-match and the control reads that Lusha has nothing for this contact

### Requirement: ENRICH_FAILED and 5xx are transient and keep any paid search

`ENRICH_FAILED` and server errors MUST release the claim for a manual retry, and MUST keep any search result already paid for so a retry does not pay the search again.

#### Scenario: Reveal fails after paid search

- GIVEN a search was paid and the enrich returned `ENRICH_FAILED`
- WHEN the BD retries manually
- THEN only the reveal is requested and no new search is charged

### Requirement: An asynchronous job response fails cleanly

If Lusha returns an asynchronous job instead of a synchronous result, the attempt MUST fail with a clear message, release the claim, and MUST NOT poll.

#### Scenario: Async job

- GIVEN Lusha returns a job reference rather than data
- WHEN the attempt settles
- THEN the BD sees a failure message and no polling is started

### Requirement: Errors never leak secrets

Error copy and logs MUST NOT contain the API key or raw Lusha response bodies containing personal data.

#### Scenario: Safe logging

- GIVEN any Lusha error
- WHEN it is logged or returned
- THEN neither the key nor the raw personal data appears
