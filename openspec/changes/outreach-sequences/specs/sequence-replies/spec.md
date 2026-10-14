# Sequence Replies Specification

## Purpose

Define how a Sequence learns that a Contact replied, which messages do not count (out-of-office and other auto-replies), what a reply does (stop, hand off to Seguimientos), and why person-level matching is the chosen trigger.

## Requirements

### Requirement: Person-level reply detection reuses the inbound classifier

A reply MUST be detected from the existing Gmail sync: an inbound `email_message` whose sender (From) matches the member's Contact, as decided by `classifyGmailMessage` (`src/lib/gmail/classify.ts`) under the owner's 2026-09-30 direction-scoped rule (only the sender of an inbound message can match; a Contact merely in To/Cc is never a reply). The Sequence MUST NOT introduce a second, thread-strict matcher. The inbound message MUST have been sent after the member's step 1 send to count.

The rationale MUST be recorded in the design: the failure mode of person-level matching is safe. Stopping a sequence too eagerly costs a manual follow-up; missing a reply and sending a robotic reminder costs credibility. Therefore the system accepts occasional over-stopping in exchange for never reminding someone who answered.

#### Scenario: Reply from the Contact stops the member

- GIVEN a member in `sent`
- WHEN the sync stores an inbound message from that Contact's address after the send
- THEN the member becomes `replied` with `replied_at` set to the message time

#### Scenario: Reply in a different thread still counts

- GIVEN a member in `sent` whose Contact writes a new email (not a thread reply)
- WHEN the sync stores it
- THEN the member becomes `replied`

#### Scenario: Contact only in To/Cc does not count

- GIVEN a member in `sent`
- WHEN an inbound email from an unrelated sender lists the Contact in Cc
- THEN the member is unchanged

#### Scenario: Message before the send does not count

- GIVEN an inbound message from the Contact dated before the step 1 send
- WHEN the sync processes it
- THEN the member is unchanged

#### Scenario: Never-logged messages cannot count

- GIVEN a message suppressed by the owner's `email_never_log` rules
- WHEN the sync processes it
- THEN it produces no reply (existing whole-message never-log behaviour)

### Requirement: Out-of-office and other auto-replies never count

An automatic message MUST NOT move a member to `replied`, MUST NOT stop the sequence, and MUST NOT cancel a pending or approved reminder. This is the single carve-out from person-level matching. An inbound message MUST be treated as automatic when any of the following holds:

- an `Auto-Submitted` header with a value other than `no`;
- an `X-Autoreply`, `X-Autorespond`, or `X-Auto-Response-Suppress` header present;
- a `Precedence` header of `auto_reply`, `bulk`, or `junk`;
- the sender is a mailer daemon / postmaster address (delivery failure notices);
- the subject begins with a known auto-reply prefix (for example "Automatic reply", "Out of Office", "Autoreply", "Respuesta automatica").

The classifier today does not expose message headers (`ParsedGmailMessage` carries only From/To/Cc/Subject/Message-ID/References), so the design MUST extend parsing so the decision is made on header data, with the subject heuristic as a fallback. The auto-reply decision MUST be a pure function so it is unit-testable.

#### Scenario: Out-of-office does not stop the sequence

- GIVEN a member in `sent`
- WHEN an inbound message from the Contact has `Auto-Submitted: auto-replied`
- THEN the member stays `sent` and the reminder remains scheduled

#### Scenario: Subject-only auto-reply

- GIVEN an inbound message with subject "Out of Office: Re: senior engineers" and no auto headers
- WHEN it is evaluated
- THEN it is treated as automatic

#### Scenario: Genuine reply that happens to mention vacation

- GIVEN an inbound message with subject "Re: senior engineers" and body "I'm on vacation next week, call me after"
- WHEN it is evaluated
- THEN it is NOT automatic and the member becomes `replied`

#### Scenario: Auto-reply then human reply

- GIVEN a member in `sent` that received an out-of-office, and later a human answer
- WHEN the second message is synced
- THEN the member becomes `replied` at the second message's time

#### Scenario: Delivery failure notice

- GIVEN an inbound message from `mailer-daemon@...`
- WHEN it is evaluated
- THEN it is automatic and does not count as a reply

### Requirement: A genuine reply stops the sequence and hands off

On a genuine reply the member MUST become `replied`; any pending or approved reminder MUST be withdrawn; the member MUST appear in Seguimientos through the existing mechanism (`reply_received` activity drives status `replied`, which `follow_up_queue_item` selects). The Sequence feature MUST NOT write `follow_up_queue_item` rows directly.

#### Scenario: Reminder withdrawn

- GIVEN a member with an approved reminder due tomorrow
- WHEN a genuine reply is synced today
- THEN the member is `replied` and the reminder is not sent

#### Scenario: Handoff uses existing queue rules

- GIVEN a member became `replied`
- WHEN the Seguimientos queue is next built
- THEN the Contact is included by its existing `replied` due rule, not by a Sequence-specific insert

#### Scenario: Card shows the outcome

- GIVEN a member that replied 6 hours ago after a send 4 days ago
- WHEN the Sequence page renders
- THEN the card shows the "Respondió" badge, "respondió hace 6 h", "secuencia detenida para este contacto", and a "Ver conversación" action linking to the Contact

### Requirement: Reminder never goes out on stale reply data

Reply detection depends on the Gmail sync. Before releasing a reminder, the runner MUST confirm that the sending account's last successful sync (`email_account.last_synced_at`) is recent enough to have seen any reply since the previous cycle (the sync interval plus a grace of 2 hours), and MUST hold the reminder (not send, not drop) when it is not. The hold MUST be visible on the card and MUST release on a later run once sync is fresh.

#### Scenario: Fresh sync

- GIVEN the account synced 3 hours before the runner and no reply exists
- WHEN the reminder is approved and due
- THEN it is released

#### Scenario: Stale sync

- GIVEN the account last synced 40 hours ago
- WHEN a reminder is approved and due
- THEN it is held with the reason "sync desactualizado" and not sent

#### Scenario: Sync never ran

- GIVEN `last_synced_at` is null
- WHEN a reminder is due
- THEN it is held

### Requirement: Human approval is the backstop for missed replies

Because person-level matching can miss a reply sent from a different address than the Contact's stored email, the reminder approval screen MUST show whether any inbound message from the Contact has been seen since the intro, so the BD can notice a missed reply before approving.

#### Scenario: Review shows reply check result

- GIVEN a reminder awaiting approval
- WHEN the BD opens "Revisar recordatorio"
- THEN the dialog states the date of the intro and that no reply has been seen since

### Requirement: Existing sync behaviour for auto-replies is unchanged by this feature

This feature changes only whether a Sequence member transitions. It MUST NOT alter how `reply_received` activities and derived Contact status are written by the existing sync for auto-replies; any change there is a separate decision.

#### Scenario: Scope of change

- GIVEN an out-of-office reply is synced
- WHEN Sequence handling runs
- THEN the member is unchanged and no other table's behaviour is modified by this change
