# Backlog

Ordered by what unblocks what, not by how much anyone wants it. The question this
list answers is **what has to be true before the BD team is let in**, because the
app is finished enough to look ready and has never been used by anyone.

Inventoried against production on 2026-09-28. Every number below was measured,
not estimated.

## Where we actually are

Everything in the database arrived by import. Nothing in it was produced by a BD
working in the app — deliberately, since the team was told to stay out while it
is in development.

| Source | Contacts |
| --- | --- |
| `linkedin_import` (now hidden from the UI) | 19,684 |
| `hubspot_import` (one run, 2026-09-26) | 5,867 |
| leads CSV (`fi-arg-2026`) | 1,053 |
| `partner_account_notes` (curated, by script) | 16 |
| **total** | **26,620** |

What the app itself has recorded, ever:

| | Count | Note |
| --- | --- | --- |
| notes | 334 | |
| emails sent | 1 | a self-test |
| calls | 0 | feature complete and reachable |
| meetings | 0 | feature complete and reachable |
| tasks | 0 | four separate creation paths |
| discards | 0 | structured reason codes already defined |

Contact statuses (`new` 17,882 · `contacted` 5,835 · `replied` 2,902 ·
`meeting` 0) are **entirely derived** from the HubSpot backfill and LinkedIn
connection counters. No status in production came from an action taken in this
app.

**So the risk is not that features are missing. It is that nothing has been
exercised by a real user.** The first BD through the door is the test.

## Layer 0 — the blocker

Nothing about email outreach can work until this is fixed, and everything below
assumes it is.

### email-coverage

| | |
| --- | --- |
| verified | **11** |
| probable | 5,218 |
| none | 21,391 |

Email is the declared primary channel. Four out of five contacts have no address
at all, and eleven have a verified one. Open tracking, sequences, templates and
reporting are all theatre on top of this.

Decide, before anything else: which slice of the base is actually reachable by
email, how the rest gets enriched (Hunter is already wired — `hunter_lookup`
activity type exists and has never fired in production), and whether `probable`
is good enough to send to. That last one is a deliverability decision, not a
technical one — bouncing 5,000 addresses costs the sending domain.

## Layer 1 — before the team comes in

These are the things that make the first week survivable.

### launch-readiness
Calls, meetings, tasks and discards are complete, reachable, and have **never
run once** outside a test. Before the team arrives, each needs one real
end-to-end pass against production data by someone who will not forgive a rough
edge. This is not QA theatre — `task.description` and `task.leadId` have full
schema, indexes, joins and rendering with **no write path anywhere**, which is
exactly the class of gap that only surfaces when a human tries to use the thing.

### task-essentials — remaining
Shipped in PR #178 (2026-09-29): every creation path writes `description` and an
assignee (validated server-side), and a teammate's overdue task — which used to
vanish from "Todas abiertas" entirely — now shows as overdue. `leadId` was left
alone on purpose: leads redirect to contacts, so there is no entry point for it.

Still open:
- **No reminders of any kind** — no cron, no notification. A BD learns a task is
  due by opening `/tasks`. A task system nobody is reminded about is a list
  nobody reads. Needs an owner decision on channel (in-app, email, both).
- **No task edit UI** anywhere, not even for the title. `updateTaskAction` is
  validated and ready but has no caller.
- `bulkCreateTaskAction` inserts one task per selected contact in a loop.

### custom-smtp
The Supabase project has no SMTP of its own. Its built-in email service only
delivers to members of the project's team, heavily rate-limited, and without
custom SMTP the auth email templates cannot be edited. Consequences today:
- **Self-service password reset is built but switched off**
  (`src/lib/auth/passwordReset.ts`, `PASSWORD_RESET_ENABLED = false`) — it
  would show "check your inbox" and nothing would arrive. The module lists the
  steps to turn it on, including making `/auth/confirm` accept a PKCE `code`.
- Invites have never been used (0 invited users in `auth.users`), so the
  invite email path is untested for the same reason.
- The Supabase dashboard's own recovery and magic-link actions are email-based
  too, so they are not a manual workaround.

Likely the avalith.net Google Workspace SMTP; decide together with the email
strategy for BD outreach.

### bd-password-reset (manual)
Until custom SMTP exists, a BD who forgets their password has no way back in
that works: every Supabase path is email-based. Setting a password directly
needs the admin API and the service-role key, which is not in `.env.local`.
Proposal: a dry-run-by-default script (`--execute --actor=<bd id>`) that sets
a random temporary password through the admin API and writes `audit_log`;
the BD then changes it at `/account/password`.

### gmail-connection
One Gmail account is connected (the owner's). Every BD needs to connect theirs
before they can send anything, and the flow has only ever been walked by one
person.

## Layer 2 — closing the loop

### email-sync
Two-way email logging on the Contact timeline, HubSpot-style.

**Why it is Layer 2 and not a nice-to-have:** `person.status` can only reach
`replied` from an inbound signal, and nothing captures inbound mail. Without
this, the pipeline physically cannot advance past `contacted` from anything a BD
does in the app. The board's `replied` column is a documented no-op for the same
reason.

- Log emails sent from the platform and from the BD's own client, plus replies,
  as threads. Only threads with contacts that exist in the CRM; never the whole
  mailbox.
- Requires `gmail.readonly`. The OAuth app is Internal, so no Google
  verification is needed, but every BD must reconnect.
- Sync via Gmail push (Pub/Sub `users.watch`) or a cron over the history API.
- Deduplicate messages already sent from the platform.
- Admins can always view every conversation; each admin view of another BD's
  conversation is audit-logged.

### follow-up-cadence
Nothing sequences follow-up. Nothing says "nobody has touched this contact in N
days". The closest thing is the Outreach view's `dormant` tier, which keys off
message history with a **12-month** threshold — useless for working a pipeline
week to week.

Decide what the cadence is before building it: a BD needs to know what to do
today, not a ranked list of everyone.

## Layer 3 — the pipeline nobody is using yet

### company-pipeline-adoption
`company.relationship_stage` (`prospect → qualified → proposal_sent → won →
lost`) **has a working write path** — an inline edit control on the company
record, and "Nueva empresa" defaults to `prospect`. It is null on all 14,255
companies because nothing backfilled the bulk-imported ones and nobody has used
the control.

This is not "build the pipeline". It is: pick a sensible default for imported
companies, and give a BD a reason to move a company along.

### account-type-filter
`company.account_type` (30 partner, 2 client) renders on the company record but
has no list filter, so the 32 accounts cannot be seen as a group. Deliberately
display-only until there is a decision on who may reclassify an account.

### owner-reporting
Reports for the owner to act on pipeline data: discard-reason breakdown, funnel
conversion by stage and by source, activity per BD over time.

**Correction to this item's original premise:** it claimed discard reasons must
first become a fixed code rather than free text. **They already are** —
`wrong_profile`, `not_interested`, `other_vendor`, `left_company`, `bad_data`,
`other`, validated, with a note required for `other`. They are stored in
`activity.metadata` JSONB, so they are queryable but not independently indexed.
What is missing is not the vocabulary; it is that zero discards exist to report
on.

## Layer 4 — product depth

### bd-playbook
An in-app manual: which roles to contact and **why** each is worth reaching —
what they decide, what pain Avalith solves for them, when they are the wrong
person. Organised by the role groups the system already classifies
(`src/lib/roleGroups.ts`), including which groups are not worth prioritising.

Ground every rationale in facts from `avalith/contexto/`; mark anything
unconfirmed as an assumption. Surface it where BDs choose who to contact — a
"por qué este rol" hint on the record, the outreach view, the role filter — not
only as a standalone page.

### account-password-current
`/account/password` sets a new password without asking for the current one,
so anyone holding an active session can lock the real user out. It also
diverges from its approved mockup (`account-password.html`: three fields and a
12-character minimum; the page has two fields and 8). Pre-existing.

(auth-ux shipped in PR #178: the post-login `next` return, with a validator
that also closed a live open redirect in `/auth/confirm`.)

### admin-email-conversation-access
`getConversationForAdmin` serves unredacted `email_sent` content as well as
LinkedIn threads, and both its UI entry points were LinkedIn surfaces that are
now hidden — so admins have no UI path to another BD's email content. The route
and its audit trail still work. Near-zero impact today (one `email_sent` row),
but it matters as email becomes the channel. Needs a LinkedIn-independent entry
point of its own design.

## Known defects

### bd-test-row
A `bd` row named `test` exists and now appears in every task "Asignado a"
list. Removing it is a production write — check it owns nothing first.

### company-contact-counts
The `/companies` list's "Contactos" column and the company record's contacts
card match `person.company_key` directly instead of resolving through
`company_alias`, so both undercount. **Latent today** — `company_alias` is
empty. The fix is written and waiting on the branch
`fix/company-contact-count-alias`; ship it the day an alias is created.

### tasks-timeline-pill
The contact record's timeline has no `Tareas` filter pill, which the mockup
specifies (`contact-record.html:97-106`). Tasks are not timeline entries today,
so this is a feature rather than a markup port. Deliberately left unbuilt rather
than faked.

## Deferred from crm-hubspot-ux

- Global cross-object search.
- Company pipeline board (`relationshipStage`).
- Task queue filters and bulk actions.

## What is NOT a lead-generation path

Recorded because it is easy to plan around wrongly: the discovery and hiring
crons (`/api/hiring/sync`, `/api/hiring/discover`) populate `target_company`
(88 rows) and `job_posting` (5,259) and feed a review queue. **They never write
a person, contact or lead.** That is company-level hiring intelligence, not
ingestion.
