# Lusha Reveal Action Specification

## Purpose

Define the per-contact action a BD uses on the Contact record to reveal an email or a phone through Lusha, and the confirm-before-spend contract around it. The action spends real money from a shared pool, so cost, scope and branding must be explicit at every step. This spec covers the interaction; the ledger, cap, match confirmation, write path and error rules live in sibling capabilities.

## Requirements

### Requirement: Reveal is offered per contact and per field, one at a time

The system MUST offer a Lusha reveal action on the Contact record for two fields, email and phone, each as its own control. A single action MUST target exactly one Contact and exactly one field. The system MUST NOT offer any list-level, bulk or "reveal all" action, and MUST NOT send more than one Lusha contact id in any enrich request.

#### Scenario: Controls appear on the record only

- GIVEN a BD opens a Contact record that has no reachable email
- WHEN the About pane renders
- THEN an email reveal control and a phone reveal control are available on that Contact
- AND no reveal control exists on any list, table or multi-select view

#### Scenario: A request names exactly one field

- GIVEN a BD confirms an email reveal
- WHEN the system calls Lusha to enrich
- THEN the request names the email field explicitly and one Lusha contact id
- AND the phone field is not requested, so no phone credit is charged

### Requirement: The action is visibly a Lusha action

The reveal control and the revealed value MUST both carry Lusha branding. The branding on the control MUST be present before the BD clicks, and the branding on the value MUST remain after the reveal.

#### Scenario: Branded before and after

- GIVEN a Contact with an eligible email reveal
- WHEN the BD views the control
- THEN it is labelled as a Lusha action
- AND after a successful reveal the stored value shows a Lusha badge

### Requirement: Every spend is confirmed first, per field

Before any credit is spent the system MUST show a confirmation dialog that states the field and the credits it will cost. Email and phone MUST use separate dialogs; confirming one MUST NOT authorize the other. A first attempt on a Contact that has no stored Lusha search MUST state the total expected cost (search plus the field price, approximately 2 credits for email and 6 for phone). Once a stored search exists the dialog MUST state only the field price (1 for email, 5 for phone).

#### Scenario: First email attempt shows the search-inclusive cost

- GIVEN a Contact with no stored Lusha search
- WHEN the BD opens the email reveal
- THEN the dialog states the expected cost of about 2 credits (1 search plus 1 email)
- AND no Lusha request has been made yet

#### Scenario: Phone needs its own confirmation

- GIVEN the BD has just revealed this Contact's email
- WHEN the BD opens the phone reveal
- THEN a separate dialog states the phone price (5 credits, search already paid)
- AND no phone credit is spent until that dialog is confirmed

#### Scenario: Dismissing the dialog spends nothing

- GIVEN a confirmation dialog is open
- WHEN the BD cancels or closes it
- THEN no Lusha request is made and no ledger credits are recorded

### Requirement: A double click never becomes a double charge

The system MUST enforce, on the server, that at most one in-flight reveal exists per Contact and field. A second request while the first is unresolved MUST be rejected as busy without calling Lusha.

#### Scenario: Two fast clicks

- GIVEN a BD confirms a reveal and the request is still in flight
- WHEN a second request for the same Contact and field arrives
- THEN the second is rejected as busy and no second Lusha call is made
- AND the total credits charged for that Contact and field is at most one reveal

### Requirement: The reveal never leaves the Contact in a partial or tombstone state

A reveal on a merged-away Contact (`merged_into_id` set) MUST be refused with an explanation and MUST NOT write to it. A reveal MUST NOT be offered for a field the Contact already holds a usable value for: an email that is already reachable (non-empty, `emailStatus` other than `none`, `emailSource` other than `pattern_inferred`), or a non-empty phone. An email that is empty, `none`, or `pattern_inferred` remains eligible.

#### Scenario: Merged Contact refused

- GIVEN a Contact whose `merged_into_id` is set
- WHEN a reveal is requested for it
- THEN the request is refused and nothing is written or charged

#### Scenario: Already-reachable email not offered

- GIVEN a Contact with a non-empty email, `emailStatus = 'verified'`
- WHEN the About pane renders
- THEN no email reveal control is offered

#### Scenario: Pattern-inferred email stays eligible

- GIVEN a Contact whose only email has `emailSource = 'pattern_inferred'`
- WHEN the About pane renders
- THEN the email reveal control is offered
