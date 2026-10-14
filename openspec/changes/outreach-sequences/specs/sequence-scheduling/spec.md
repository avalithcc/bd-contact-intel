# Sequence Scheduling Specification

## Purpose

Define the cadence, the scheduler that releases approved emails, the per-day send cap enforced in code, the sending identity as a reference to an `email_account` row, and the safety properties of the send path (idempotency, re-checks, failure handling).

## Requirements

### Requirement: Cadence

Step 1 MUST be scheduled for 09:00 America/New_York ("Miami time") on the calendar day after approval. Step 2 (reminder) MUST be due 7 days after the step 1 send, and MUST be sent only if the member has not replied (see `sequence-replies`) and the reminder has been approved (see `sequence-approval`). The due-instant calculation MUST be a pure function of (approval or send instant, IANA timezone) so it is unit-testable and DST-correct. Weekends and holidays are not skipped.

#### Scenario: Step 1 scheduled next day

- GIVEN approval at 2026-10-14 16:30 America/New_York
- WHEN the schedule is computed
- THEN step 1 is due 2026-10-15 09:00 America/New_York

#### Scenario: Approval after midnight Miami time

- GIVEN approval at 2026-10-14 23:50 America/New_York
- WHEN the schedule is computed
- THEN step 1 is due 2026-10-15 09:00 America/New_York

#### Scenario: DST boundary

- GIVEN approval on 2026-11-01 (the day DST ends in the US)
- WHEN the schedule is computed
- THEN step 1 is due 2026-11-02 09:00 America/New_York, which is 14:00 UTC, not 13:00 UTC

#### Scenario: Reminder is 7 days after the send, not after approval

- GIVEN step 1 was actually sent 2026-10-15 09:02
- WHEN the reminder due date is computed
- THEN it is 2026-10-22

#### Scenario: Step 1 delayed by the cap pushes the reminder

- GIVEN step 1 was due 2026-10-15 but cap-limited and actually sent 2026-10-16
- WHEN the reminder due date is computed
- THEN it is 2026-10-23

### Requirement: Never earlier than 09:00 Miami

The scheduler MUST NOT release any step before 09:00 America/New_York of its due date. A due step MUST be released by the first scheduler run at or after its due instant, subject to the cap. The deployment MUST invoke the runner often enough that a due step is released within the same Miami calendar day; the invocation cadence is a design decision, but it MUST tolerate the fact that a fixed UTC cron drifts one hour against Miami wall-clock time across DST.

#### Scenario: Run before the due instant

- GIVEN a step due 2026-10-15 09:00 Miami and a run at 08:00 Miami
- WHEN the runner executes
- THEN the step is not released

#### Scenario: Run after the due instant

- GIVEN the same step and a run at 09:30 Miami
- WHEN the runner executes
- THEN the step is released

### Requirement: Daily send cap enforced in the scheduler

The scheduler MUST refuse to release more than the Sequence's `daily_send_cap` emails per America/New_York calendar day, regardless of how many members are approved. The cap MUST be enforced in the code that releases sends, not only in the UI. Steps 1 and 2 count equally against the cap. The count MUST be derived from sends actually recorded, per sending account per Miami day, across all Sequences using that account, so splitting work across Sequences cannot bypass it. Excess approved steps MUST remain approved and be released on later runs; they MUST NOT be dropped or auto-cancelled. Release order MUST be oldest due instant first, ties broken by earliest `approved_at`.

#### Scenario: 8 approved, cap 5

- GIVEN 8 approved members all due today and `daily_send_cap = 5` with 0 sent today
- WHEN the runner executes
- THEN exactly 5 are sent
- AND 3 remain `approved`
- AND the next day's run sends the remaining 3

#### Scenario: Cap already consumed

- GIVEN 5 emails were already sent today from the account
- WHEN the runner executes again
- THEN no further email is sent

#### Scenario: Two Sequences, one account

- GIVEN two Sequences on the same account, each with cap 5 and 5 approved due members
- WHEN the runner executes
- THEN no more than 5 are sent from that account that Miami day, unless both caps differ, in which case the lower cap applies to the account's total

#### Scenario: Reminders share the cap

- GIVEN 3 reminders and 4 intro emails due today with cap 5
- WHEN the runner executes
- THEN exactly 5 are sent, in oldest-due-first order

#### Scenario: Failed sends do not consume the cap

- GIVEN a send attempt that fails at Gmail
- WHEN the cap count is computed
- THEN the failed attempt is not counted

#### Scenario: Cap lowered mid-day

- GIVEN 3 already sent today and the cap is edited to 2
- WHEN the runner executes
- THEN nothing more is sent that day

### Requirement: Sending identity is a reference

A Sequence MUST reference its sending identity by a foreign key to an `email_account` row. No sender address MUST be hardcoded in code, prompts, or configuration for Sequence sends. The sender address shown in the UI and used in the message From MUST be read from the referenced account row. Pointing a Sequence at a different connected account MUST require changing only that reference.

Note for design: `email_account` is currently keyed by `bd_id` (one row per BD, no separate id) and `sendGmailMessage` selects the account by `bdId`. The reference therefore needs a stable key on `email_account` and the send path MUST send through the account the Sequence references.

#### Scenario: Switching accounts is a data change

- GIVEN a Sequence referencing account A
- WHEN its reference is changed to account B
- THEN subsequent sends go out from B's address with no code change

#### Scenario: No hardcoded address

- GIVEN the Sequence source files
- WHEN searched for `@avalith.net`
- THEN no sender address literal exists outside seeds, fixtures, and tests

#### Scenario: Referenced account not connected

- GIVEN the referenced account has status `error` or `revoked`
- WHEN the runner executes
- THEN no email is sent for that Sequence
- AND the Sequence shows that the account needs reconnecting at `/account/email`

#### Scenario: Account belongs to the owner

- GIVEN a BD creating a Sequence
- WHEN they choose a sending account
- THEN only accounts they own can be chosen

### Requirement: Runner endpoint follows the cron pattern

The runner MUST be exposed as a route authenticated with the `CRON_SECRET` bearer token via `isValidBearer`, MUST fail closed (401) when the secret is unset or the header is wrong, MUST declare `dynamic = "force-dynamic"` and an explicit `maxDuration`, MUST be excluded from the Supabase session gate, and MUST be registered in `vercel.json` crons. It MUST NOT be triggerable by a logged-in user session alone.

#### Scenario: Missing bearer

- GIVEN a request with no Authorization header
- WHEN the route is called
- THEN it responds 401 and sends nothing

#### Scenario: Secret unset

- GIVEN `CRON_SECRET` is not configured
- WHEN any request arrives
- THEN it responds 401

#### Scenario: Valid bearer

- GIVEN a correct bearer token
- WHEN the route is called
- THEN the runner executes and returns a JSON summary of released, held, and failed counts

### Requirement: Each step is sent at most once

A step for a member MUST be claimed atomically before the Gmail call, so overlapping or retried runner invocations cannot send it twice. If a claim exists but the outcome is unknown (for example the process died after Gmail accepted the message but before the result was recorded), the system MUST NOT auto-resend; it MUST surface the member to the BD as needing manual confirmation. At-most-once is preferred over at-least-once.

#### Scenario: Concurrent runs

- GIVEN two runner invocations start at the same time with one approved due member
- WHEN both execute
- THEN exactly one email is sent

#### Scenario: Retry after a crash

- GIVEN a member whose claim exists with no recorded result
- WHEN the runner executes again
- THEN that member is not re-sent and is flagged for manual check

### Requirement: Pre-send re-checks

Immediately before releasing a step, the runner MUST re-verify and skip (not send) when any check fails:

| Check | Failure behaviour |
|-------|-------------------|
| Member state is still `approved` (or reminder approved) | skip |
| Contact not merged and still has an email | skip, flag |
| Recipient not on the suppression list | skip, member held with reason |
| Company has no `client_status` | skip, member held with reason |
| Compliance footer present in body (see `sequence-compliance`) | skip, flag |
| For reminders: no genuine reply recorded, and sync is fresh (see `sequence-replies`) | skip or hold |

A skipped member MUST be visible to the BD with the reason; it MUST NOT silently disappear and MUST NOT count against the cap.

#### Scenario: Company became a client

- GIVEN an approved member whose company was set to `client_status = 'active'` yesterday
- WHEN the runner executes
- THEN the email is not sent and the card shows why

#### Scenario: Recipient opted out after approval

- GIVEN an approved member whose address was suppressed after approval
- WHEN the runner executes
- THEN the email is not sent

### Requirement: Send failure handling

On a Gmail failure the member MUST NOT be marked `sent`. A `reauth_required` or `not_connected` failure MUST halt all remaining sends for that account in the run. A `temporary` or `send_failed` failure MUST affect only that member and MUST NOT halt others. Failed members MUST remain eligible for a later run and MUST show the failure to the BD. The runner MUST NOT retry the same member in a tight loop within one run.

#### Scenario: Token revoked mid-run

- GIVEN a run releasing 4 emails and the first fails with `reauth_required`
- WHEN the runner continues
- THEN the remaining 3 are not attempted and all 4 members stay `approved`

#### Scenario: One member fails

- GIVEN the second of 4 sends fails with `send_failed`
- WHEN the runner continues
- THEN the other 3 are attempted

### Requirement: Sends are recorded on the Contact

Every successful Sequence send MUST be recorded through the existing send path as an `email_sent` activity on the Contact (actor = the Sequence owner BD) and an `email_message` row, with the Sequence id and the step number included in the activity metadata. The Contact's derived status MUST follow existing `deriveStatus` rules (a sent email moves `new` to `contacted`). Sequence-specific events MUST NOT introduce a new way to set status directly.

#### Scenario: Send appears on the record

- GIVEN a Sequence step 1 is sent
- WHEN the Contact record's timeline loads
- THEN an email-sent entry exists with the Sequence id and step 1 in its metadata

#### Scenario: Status updates through derivation

- GIVEN a Contact with status `new`
- WHEN a Sequence email is sent to them
- THEN their status derives to `contacted`

### Requirement: Reminder sends in the original thread

The reminder MUST be sent as a reply on the step 1 Gmail thread, using the thread headers the platform already stores for replies (`In-Reply-To`, `References`, `threadId`), so it appears as a follow-up to the original message. If the thread headers are unavailable the runner MUST hold the reminder and surface the reason rather than send an unthreaded message.

#### Scenario: Threaded reminder

- GIVEN a member whose step 1 has a stored RFC Message-ID
- WHEN the reminder is released
- THEN the message carries `In-Reply-To` equal to that Message-ID and the same `threadId`

#### Scenario: Missing Message-ID

- GIVEN step 1 has no stored RFC Message-ID
- WHEN the reminder is due and approved
- THEN it is held with an explicit reason and not sent
