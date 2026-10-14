# Sequence Approval Specification

## Purpose

Define the human approval gate: per-contact approval, bulk approval blocked until every selected draft has been opened, cancellation, and the independent approval the reminder needs. Nothing leaves without an explicit approval for that specific message.

## Requirements

### Requirement: Nothing is sent without approval

A step MUST be eligible for sending only if a BD approved that exact step's current content. Creating a Sequence, generating drafts, or reaching a due date MUST NOT approve anything.

#### Scenario: Unapproved draft never sends

- GIVEN a member in `drafted`
- WHEN the scheduler runs on and after the would-be send time
- THEN no email is sent for that member

### Requirement: Member state machine

Each member MUST be in exactly one of `drafted`, `approved`, `sent`, `replied`, `no_reply`, `discarded`. Allowed transitions:

| From | To | Trigger |
|------|----|---------|
| `drafted` | `approved` | BD approves step 1 |
| `approved` | `drafted` | BD cancels ("Cancelar envío"), edits, or regenerates |
| `approved` | `sent` | Scheduler releases step 1 |
| `sent` | `replied` | Genuine reply detected (see `sequence-replies`) |
| `sent` | `no_reply` | Step 2 sent (see Requirement: Terminal no-reply) |
| `no_reply` | `replied` | Genuine reply detected later |
| `drafted`, `approved` | `discarded` | BD removes member |
| `discarded` | `drafted` | BD re-admits ("Reincorporar") |

Every other transition MUST be rejected. In particular, `sent` -> `approved`, `replied` -> `sent`, and any transition out of `sent` caused by an out-of-office auto-reply MUST be impossible.

#### Scenario: Invalid transition rejected

- GIVEN a member in `sent`
- WHEN an approve action is submitted for step 1
- THEN the request is rejected and the state is unchanged

#### Scenario: Cancel returns to drafted

- GIVEN a member in `approved` whose send is scheduled for tomorrow
- WHEN the BD uses "Cancelar envío"
- THEN the member is `drafted` with `approved_at` cleared and no email is sent

### Requirement: Single approval

"Aprobar" / "Aprobar y programar" on a member MUST set `approved_at` to the current time, record the actor, and compute the scheduled send instant per `sequence-scheduling`. The approval MUST bind to the draft content as it was when approved; a later edit MUST withdraw the approval.

#### Scenario: Approve schedules for next day 09:00 Miami

- GIVEN a member in `drafted` and the current Miami time is 2026-10-14 14:00
- WHEN the BD approves
- THEN `approved_at` is set and the step 1 send is scheduled for 2026-10-15 09:00 America/New_York

#### Scenario: Edit after approval withdraws it

- GIVEN a member in `approved`
- WHEN the BD saves a changed body
- THEN the member returns to `drafted` and must be approved again

### Requirement: Review tracking

The system MUST record, per member and per step, whether the BD has opened that draft in the review dialog ("revisado"). Opening the dialog MUST set the flag; the flag MUST persist across page loads and sessions. Any change to the draft content (edit or regenerate) MUST clear it, so a bulk approval cannot approve content the BD has not seen.

#### Scenario: Opening marks reviewed

- GIVEN a member with `reviewed = false`
- WHEN the BD opens "Revisar borrador"
- THEN `reviewed` becomes true and stays true after reload

#### Scenario: Regenerate clears reviewed

- GIVEN a member with `reviewed = true`
- WHEN the BD regenerates the draft
- THEN `reviewed` is false

#### Scenario: Passive listing does not mark reviewed

- GIVEN a member list with 10 cards visible
- WHEN the page loads
- THEN no member is marked reviewed

### Requirement: Bulk approval is blocked until all selected drafts were opened

The bulk bar MUST show "N de M borradores revisados" (N reviewed among the M selected). The primary action "Aprobar y programar los M" MUST be disabled whenever N < M, and MUST be enabled only when N = M. The server MUST enforce the same rule, rejecting a bulk approve request that includes any member whose `reviewed` flag is false, regardless of what the client sent.

#### Scenario: Incomplete review disables the button

- GIVEN 3 selected drafts, 1 of which has been opened
- WHEN the bulk bar renders
- THEN it shows "1 de 3 borradores revisados"
- AND the "Aprobar y programar los 3" button is disabled

#### Scenario: Complete review enables the button

- GIVEN 3 selected drafts, all opened
- WHEN the bulk bar renders
- THEN it shows "3 de 3 borradores revisados" and the button is enabled

#### Scenario: Server rejects forged bulk approval

- GIVEN 3 members, 1 with `reviewed = false`
- WHEN a bulk approve request including all 3 reaches the server
- THEN none of the 3 is approved and the response names the unreviewed member

#### Scenario: Selection change recomputes the gate

- GIVEN 3 selected, 3 reviewed, then the BD adds an unreviewed 4th row to the selection
- WHEN the bar re-renders
- THEN it shows "3 de 4 borradores revisados" and the button is disabled

### Requirement: Single approve is not gated by the counter

The per-card "Aprobar" button MUST be available on a draft that has not been opened, because approving one message is a deliberate act on one visible card. The system MUST still record the approval actor and time.

#### Scenario: Approve from the card

- GIVEN a `drafted` member that was never opened
- WHEN the BD clicks "Aprobar" on the card
- THEN the member is approved

### Requirement: Reminder needs its own approval

The step 2 reminder MUST NOT be sent unless the BD approved the reminder itself. Approval of step 1 MUST NOT imply approval of step 2. An unapproved reminder MUST NOT expire into an automatic send; it stays pending indefinitely until approved, discarded, or the member replies.

#### Scenario: Step 1 approval does not approve the reminder

- GIVEN a member whose step 1 was approved and sent
- WHEN 7 days pass with no reply and the reminder was never approved
- THEN no reminder is sent
- AND the card shows "Recordatorio hoy" with "Revisar recordatorio" and "Aprobar"

#### Scenario: Reminder bulk approval uses the same review gate

- GIVEN several reminders selected for bulk approval
- WHEN not all have been opened
- THEN the bulk approve button is disabled

#### Scenario: Reply cancels a pending reminder

- GIVEN a reminder awaiting approval
- WHEN the member replies
- THEN the reminder is withdrawn and cannot be approved

### Requirement: Reminder timing on approval

An approved reminder MUST send at the first release at or after both (a) 7 days after the step 1 send and (b) the next 09:00 America/New_York following the approval. "Adelantar recordatorio" MAY move (a) earlier but MUST NOT bypass approval, the reply check, or the daily cap.

#### Scenario: Approved on the due day before 09:00

- GIVEN the reminder is due 2026-10-21 and approved at 08:00 Miami that day
- WHEN the scheduler runs after 09:00
- THEN the reminder is released that day

#### Scenario: Approved after 09:00 on the due day

- GIVEN the reminder is approved at 10:00 Miami on its due day
- WHEN the scheduler runs that day
- THEN it is not sent that day and is released at the next day's 09:00 window

#### Scenario: Advancing still requires approval

- GIVEN a member in `sent` with an unapproved reminder
- WHEN the BD uses "Adelantar recordatorio"
- THEN the reminder becomes due now but is not sent until approved

### Requirement: Terminal no-reply

Once the reminder is sent, the member MUST move to `no_reply`. `no_reply` is terminal for sending (no step 3) but a later genuine reply MUST still be detected and move the member to `replied`.

#### Scenario: Reminder sent

- GIVEN a member in `sent` whose reminder is released
- WHEN the send succeeds
- THEN the member is `no_reply` and no further step is scheduled

#### Scenario: Late reply after no_reply

- GIVEN a member in `no_reply`
- WHEN a genuine reply arrives and is synced
- THEN the member is `replied` and handed to Seguimientos

### Requirement: Approval actions are logged with the actor

Approve, cancel, discard, re-admit, and regenerate MUST each record the actor BD and timestamp so the history of who authorized each send is recoverable.

#### Scenario: Approval is attributable

- GIVEN a BD approves a member
- WHEN the approval is stored
- THEN the record contains the BD id and the time
