# Sequence Roster Specification

## Purpose

Define what a Sequence is, how its roster of hand-picked Contacts is built and frozen, and the guardrails (per-company cap, client exclusion, reachability) that decide who may be on it. A Sequence is a named batch of 1:1 emails sent from a BD's own Gmail account; it is deliberately not a Campaign (no marketing-attribution semantics, no asset container).

## Requirements

### Requirement: A Sequence is a named, owner-scoped batch

The system MUST store a Sequence with a name, an owning BD, a reference to the sending email account, a daily send cap, a cadence schedule, and a creation timestamp. The product surface MUST call it "Secuencia" everywhere; the words "Campaña" / "Campaign" MUST NOT appear in the UI, routes, or table names for this feature.

#### Scenario: Sequence is created with a name

- GIVEN a BD is creating a Sequence
- WHEN they submit without a name
- THEN the Sequence is not created

#### Scenario: Sequence belongs to its creator

- GIVEN BD A creates a Sequence
- WHEN BD B opens the Sequences list
- THEN BD B does not see BD A's Sequence or any of its drafts

#### Scenario: Admin read of another BD's drafts is audited

- GIVEN BD A has a Sequence with drafted email bodies
- WHEN an admin opens that Sequence
- THEN the draft bodies are visible
- AND an audit log entry records the admin, BD A, and the timestamp, per the `admin-access-audit` rules

### Requirement: Roster is frozen membership, not a query

A Sequence's roster MUST be an explicit, persisted set of (Sequence, Contact) members chosen by the BD. It MUST NOT be derived from stored filters. Changes to the underlying Contact, Company, or job-posting data MUST NOT add or remove members. A Contact MUST appear at most once per Sequence.

#### Scenario: Roster does not drift

- GIVEN a Sequence was created with 10 members
- WHEN a new reachable Contact later appears at a company with open IT postings
- THEN the Sequence still has exactly 10 members

#### Scenario: Same Contact cannot be added twice

- GIVEN a Contact is already a member of a Sequence
- WHEN the BD tries to add the same Contact again
- THEN the roster is unchanged

#### Scenario: Neither existing primitive is used

- GIVEN the feature is implemented
- WHEN membership is stored
- THEN it is not stored in `saved_view` or `follow_up_queue_item`

### Requirement: Candidate pool is reachable Contacts at US companies with open IT postings

The roster picker MUST offer only Contacts that are reachable: not merged (`merged_into_id` is null), with a non-empty email, with `email_status` other than `none`, and with an email that is not pattern-inferred (`email_source` is not `pattern_inferred`). The Contact's company MUST have at least one open IT posting (`is_it` true, `closed_at` null) in the US market.

The picker's "Florida" label MUST be derived from `job_posting.is_miami`, which means all of Florida (authority: `src/lib/hiring/markets.ts`, not the stale comment in `src/db/schema.ts`). The picker MUST NOT filter or rank by `target_company.is_startup`, because that value is a lazily populated, nullable inference.

#### Scenario: Merged Contact is not offered

- GIVEN a Contact whose `merged_into_id` is set
- WHEN the picker loads
- THEN that Contact is not offered

#### Scenario: Pattern-inferred email is not offered

- GIVEN a Contact whose only email has `email_source = 'pattern_inferred'`
- WHEN the picker loads
- THEN that Contact is not offered

#### Scenario: No open IT posting means not offered

- GIVEN a Contact at a company whose IT postings are all closed
- WHEN the picker loads
- THEN that Contact is not offered

#### Scenario: Startup flag is not a filter

- GIVEN two otherwise eligible Contacts, one at a company with `is_startup` NULL
- WHEN the picker loads
- THEN both are offered, and no startup toggle exists

#### Scenario: Florida badge covers all of Florida

- GIVEN a Contact at a company whose open posting is in Tampa (`is_miami` true)
- WHEN the member card renders
- THEN it shows the "Florida" badge

### Requirement: Maximum 2 active members per company

A Sequence MUST NOT contain more than 2 non-discarded members whose Contacts belong to the same company (`person.company_key`). The rule MUST be enforced at the server on add, on bulk add, and on re-admitting a discarded member, not only in the UI.

#### Scenario: Third contact at one company is refused

- GIVEN a Sequence already has 2 non-discarded members at Twilio
- WHEN the BD adds a third Twilio Contact
- THEN the add is rejected with a message naming the 2-per-company limit
- AND the roster is unchanged

#### Scenario: Discarded members do not count

- GIVEN a Sequence has 2 members at Bold, one of them discarded
- WHEN the BD adds another Bold Contact
- THEN the add succeeds

#### Scenario: Re-admitting respects the limit

- GIVEN a discarded member at Snowflake and 2 other active Snowflake members
- WHEN the BD uses "Reincorporar" on the discarded member
- THEN the re-admission is rejected

#### Scenario: Bulk add trims nothing silently

- GIVEN a bulk add of 3 Contacts at the same company
- WHEN it is submitted
- THEN the request is rejected as a whole, or the over-limit Contacts are rejected with an explicit per-Contact reason
- AND no Contact is dropped without being reported

### Requirement: Client companies are excluded

A Contact whose company has `company.client_status` set (either `active` or `inactive`) MUST NOT be offered by the picker, MUST be rejected on add, and MUST be re-checked at send time (see `sequence-scheduling`). The exclusion MUST be driven by `client_status` only. Correcting the unmarked clients CookUnity and Mercado Libre is a separate change and out of scope here.

#### Scenario: Active client excluded

- GIVEN a company with `client_status = 'active'`
- WHEN the picker loads
- THEN none of its Contacts are offered

#### Scenario: Inactive client also excluded

- GIVEN a company with `client_status = 'inactive'`
- WHEN a BD attempts to add one of its Contacts via a direct request
- THEN the add is rejected

#### Scenario: Company becomes a client after the roster was built

- GIVEN a member whose company is later marked `client_status = 'active'`
- WHEN the scheduler considers that member for release
- THEN the member is not sent (see `sequence-scheduling`)

### Requirement: Suppressed recipients cannot be added

A Contact whose email address is on the send-suppression list (see `sequence-compliance`) MUST NOT be offered or accepted onto any Sequence.

#### Scenario: Opted-out Contact rejected

- GIVEN a Contact whose address is suppressed
- WHEN the BD tries to add them
- THEN the add is rejected

### Requirement: Removing and re-admitting members

"Quitar de la secuencia" MUST move a member to `discarded` and record a discard reason and the actor. A discarded member MUST NOT receive any further step. "Reincorporar" MUST return a discarded member to `drafted`, subject to every roster guardrail, and MUST NOT carry over a stale approval.

#### Scenario: Removal records a reason

- GIVEN a member in `drafted`
- WHEN the BD removes them with the reason "sin cargo, no se puede personalizar"
- THEN the member is `discarded` and shows "Lo quitaste hace 1 d · motivo: ..."

#### Scenario: Removal requires a reason

- GIVEN the BD removes a member
- WHEN they submit without a reason
- THEN the member is not discarded

#### Scenario: Re-admission drops the old approval

- GIVEN a member who was approved, cancelled, then discarded
- WHEN the BD uses "Reincorporar"
- THEN the member is `drafted` with `approved_at` cleared

### Requirement: Sequence settings

The Sequence MUST carry a `daily_send_cap` (positive integer, default 5) and a `schedule` describing the cadence defined in `sequence-scheduling`. Editing the cap MUST take effect for the next scheduler run. A cap above a system-wide ceiling (initially 15) MUST be rejected. A cap above 8 SHOULD show a warning that sustained demand above ~8/day is the trigger to migrate to a dedicated sending subdomain.

#### Scenario: Default cap

- GIVEN a BD creates a Sequence without touching the cap
- WHEN it is saved
- THEN `daily_send_cap` is 5

#### Scenario: Invalid cap rejected

- GIVEN a BD enters a cap of 0, -3, 2.5, or 500
- WHEN they save
- THEN the save is rejected

#### Scenario: High cap warns

- GIVEN a BD enters a cap of 12
- WHEN they save
- THEN the save succeeds and a warning about domain reputation is shown
