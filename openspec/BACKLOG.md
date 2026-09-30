# Backlog

Ordered by what unblocks what, not by how much anyone wants it. The question this
list answers is **what has to be true before the BD team is let in**, because the
app is finished enough to look ready and has never been used by anyone.

Inventoried against production on 2026-09-28. Refreshed 2026-09-30 against PRs
#198–#223 (Seguimientos queue, email sync, task edit/bulk create, pipeline
backfill, account-type filter, playbook, DMARC fix).

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

That was true on 2026-09-28. By 2026-09-30, most of what stood between the team
and a usable app has shipped — see **Shipped** below. What's left is a short
list of in-progress items (email sync's last mailbox, two mockups, one UI bug)
and manual owner actions (11 duplicate merges, the password-reset smoke test,
the remaining name splits). None of that changes the core fact: the database
still holds zero BD-produced activity. **The first BD through the door is
still the test.**

## Shipped

- Follow-up cadence: the Seguimientos queue, capped at 10 contacts/day per BD
  (#215). Decisions in `openspec/decisions/2026-09-30-decision-brief.md`.
- Email coverage stage 1: 480 emails deduced from each domain's dominant
  pattern, labelled "Deducido" (#207). Hunter stage 2 (paid lookup) stays
  deferred — a cost/deliverability call for the owner.
- Default pipeline stage: 14,255 companies backfilled — 2 `won` / 831
  `qualified` / 13,422 `prospect` (#205); new companies now default to
  `prospect`.
- Account-type filter on the companies list, display-only until reclassification
  rules are decided (#211).
- Task essentials: every creation path writes `description` and a validated
  assignee (#178); task edit with an audited activity log (#216); bulk task
  create as one set-based insert instead of a per-contact loop (#220); the
  Tareas filter pill on the contact timeline (#203); dialog markup regressions
  guarded by `tests/unit/dialogMarkup.test.ts` (#197).
- Task reminders: daily digest email + sidebar "Tareas" count (#188), branded
  (#194), hardened against abandoned claims (#195).
- `parseDbTimestamp` UTC helper (#212) — see **timestamptz migration** below
  for the rest of the column conversion.
- Guía de roles (bd-playbook): in-app manual on which roles to contact and why,
  with in-context "por qué este rol" hints (#223).
- Auth/security hardening: RLS on every table, sign-ups disabled, current
  password required to change it, server-side `@avalith.net` + confirmed-email
  gate (#183–#185); `password_min_length` raised to 12; reset script audited
  and verified.
- Custom SMTP via HostGator `notificaciones@avalith.net`; password reset
  verified end to end. DMARC `rua` fixed 2026-09-30 — now points to
  `notificaciones@avalith.net` (was the placeholder `email@yourdomain.com`).

## Layer 1 — before the team comes in

These are the things that make the first week survivable.

### launch-readiness
Calls, meetings, tasks and discards are complete, reachable, and have **never
run once** outside a test. Before the team arrives, each needs one real
end-to-end pass against production data by someone who will not forgive a rough
edge. This is not QA theatre — `task.description` and `task.leadId` have full
schema, indexes, joins and rendering with **no write path anywhere**, which is
exactly the class of gap that only surfaces when a human tries to use the thing.

### bd-password-reset (manual) — shipped, not yet run
`scripts/reset-bd-password.ts` (PR #179) sets a random temporary password
through the Supabase admin API, writes `audit_log`, and prints the password
once. Dry run is the default; `--execute --actor=<bd id>` needs
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, which is not there yet. The admin
call and the audit insert have never run: the first `--execute` should be on
the owner's own account, as the smoke test.

### gmail-connection
Every BD needs to connect their own Gmail account before they can send
anything. Cristian and Macarena have reconnected with the new readonly scope
(needed for email sync, below); the rest of the team still needs to walk the
flow at all.

## Layer 2 — closing the loop

### email-sync
Two-way email logging on the Contact timeline, HubSpot-style. Shipped: backend
— readonly scope, message store, sync route, 90-day first-sync backfill
(#217); UI — threads, connection states, never-log, reconnect banner (#222);
never-log now suppresses the whole message rather than per-address (#218).
Runs via Supabase `pg_cron` every 15 minutes (`net.http_get`,
`scripts/gmail-sync-cron.sql`). This is what lets `person.status` reach
`replied` from an inbound signal — previously nothing captured inbound mail.

Still open:
- Mariel's mailbox is not Gmail, so it is not synced — needs its own path or
  stays manual.
- Admins have no UI path to another BD's email conversation yet — see
  `admin-email-conversation-access` below.

## Layer 3 — the pipeline nobody is using yet

### owner-reporting
Mockup in progress (2026-09-30). Reports for the owner to act on pipeline
data: discard-reason breakdown, funnel conversion by stage and by source,
activity per BD over time.

**Correction to this item's original premise:** it claimed discard reasons must
first become a fixed code rather than free text. **They already are** —
`wrong_profile`, `not_interested`, `other_vendor`, `left_company`, `bad_data`,
`other`, validated, with a note required for `other`. They are stored in
`activity.metadata` JSONB, so they are queryable but not independently indexed.
What is missing is not the vocabulary; it is that zero discards exist to report
on.

## Layer 4 — product depth

### admin-email-conversation-access
Mockup in progress (2026-09-30). `getConversationForAdmin` serves unredacted
`email_sent` content as well as LinkedIn threads, and both its UI entry points
were LinkedIn surfaces that are now hidden — so admins have no UI path to
another BD's email content. The route and its audit trail still work.
Near-zero impact today (one `email_sent` row), but it matters as email becomes
the channel.

### auth-security — remaining
- The invite email template still uses the default `{{ .ConfirmationURL }}`.
  Invites are not used today (the owner creates users with a password and Auto
  Confirm); if they ever are, switch it to the token_hash shape first.
- `mailer_autoconfirm` is still on; harmless while sign-ups are disabled.

### timestamptz migration
All timestamp columns are `timestamp without time zone`. Plan:
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md`. Slice 0 (prep,
no schema change) is done (#221). Slices 1–6 — small tables, imported tables,
lead/person, company, activity/task, email/follow-up tables — are pending.
Until they land, run local checks with `TZ=UTC`.

### free-ai-for-simple-tasks — research first
Owner request (2026-09-30): use other AI models for simple, low-stakes
("dummy") tasks, preferring **free** options, possibly choosing a different
model per task. Nothing is decided yet; this is a research item.

- Today every AI call goes through the Vercel AI Gateway (`ai` +
  `@ai-sdk/gateway`): outreach message generation
  (`src/lib/outreach/generateMessage.ts`, a Sonnet-class model) and the
  startup classifier (`src/lib/hiring/startupClassification.ts`, a cheap model).
  The gateway already routes to many providers by model string, so switching
  a task to another model is usually a one-line change.
- Research questions:
  - which tasks count as simple (classification, name or title
    normalization, short summaries, tagging)
  - which models are free or near-free for each, and at what quality
  - rate limits and data-retention terms (contact data must not be used for
    training)
  - whether the gateway's own free tier or credits already cover it
- Output: a short decision brief in `openspec/decisions/` with a per-task
  model recommendation, cost, and the privacy terms.

## Known defects

### contact-names
- 143 of 191 stuffed full-names were split 2026-09-29
  (`scripts/backfill-split-stuffed-names.ts`, PR #186, audit row `df7a98fe`,
  revertible). The rest are genuinely ambiguous ("Gonzalo Castro Peña": one
  given name and two surnames, or the reverse), start with a particle, or are
  junk. **A first-token split for this remainder is in progress** — count
  pending.
- 233 contacts with no name at all whose email cannot be split reliably
  (`gusoliva@`, `maria.laura.fantoni@`, digits, initials). Needs another
  source (LinkedIn, enrichment) or a BD.
- 11 duplicate pairs open in `/admin/duplicates` — still owner action.

### company-contact-counts
The `/companies` list's "Contactos" column and the company record's contacts
card match `person.company_key` directly instead of resolving through
`company_alias`, so both undercount. **Latent today** — `company_alias` is
empty. The fix is written and waiting on the branch
`fix/company-contact-count-alias`; ship it the day an alias is created.

### edit-pencil-hover
The inline edit-pencil icon turns red on hover instead of the intended hover
state. Fix in progress.

### contacts-list-mapping
`/contacts` list round trips went from 4 to 2 (#196). The JSON-to-row mapping
it added (`mapInlineDerivedColumns` in `listQueries.ts`) has no unit test;
extract it into a DB-free module and assert it matches `attachDerivedColumns`.

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
