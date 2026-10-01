# Backlog

Ordered by what unblocks what, not by how much anyone wants it. The question this
list answers is **what has to be true before the BD team is let in**, because the
app is finished enough to look ready and has never been used by anyone.

Inventoried against production on 2026-09-28. Refreshed 2026-09-30 against PRs
#198–#223 (Seguimientos queue, email sync, task edit/bulk create, pipeline
backfill, account-type filter, playbook, DMARC fix). Re-verified 2026-09-30
against PRs #224–#251 (Argentina timezone fixes, owner reports, audited admin
conversation access, company search, Digital Finance Forum import, remaining
name splits, duplicates-queue tooling).

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
- Argentina timezone fixes (#247): `workedTodayExists` and the follow-up badge
  now bound the real instant with `argentinaInstantDayWindow` instead of the
  naive 00:00-UTC `argentinaDayBoundaries` scheme (built only for
  `task.due_at`); server and client date rendering unified on Argentina time
  everywhere (`contacts/[id]`, `companies/[key]`, both Timelines); `planCall`/
  `planMeeting` now parse the BD's wall-clock date/time input as ART instead
  of the server process's timezone. A guard test fails the build if a new
  caller imports `argentinaDayBoundaries` without being classified as
  `due_at`-only.
- Remaining stuffed-name split (#226): first-token/compound-given-name rule,
  gated behind the original classifier, applied in production 2026-09-30 —
  48 persons split, audit row `person_first_token_split_backfill`,
  `person_property_history` per field, `--revert` supported. Re-run finds 0
  remaining under this rule.
- Audited admin access to BD conversations (#232) and one shared conversation
  modal (#237): admins can view another BD's conversation — including synced
  Gmail threads, previously ignored by that view — after an explicit confirm;
  every view writes to `audit_log` before the read; the BD is never notified.
  The earlier standalone admin page is deleted in favor of one
  `ConversationDialog` used by both the BD's own view and the admin path.
- Owner reporting (#234, #239): Administración → Reportes (admin-only) —
  KPIs, discard-reason breakdown, contact funnel by source, company pipeline,
  per-BD activity, tasks completed, follow-up queue adherence; period
  (week/month/quarter, Argentina calendar) and BD filter in the URL. A
  follow-up fix (#239) made the BD filter actually apply on change and fixed
  the KPI/activity-table scope mismatch.
- Company search (#242): tokenized ILIKE search over `display_name`, `domain`
  and `company_alias` via a correlated `EXISTS`, applied to both the page
  query and the view-tab counts; the header search is now context-aware
  instead of always routing to `/contacts`.
- Merge data-safety fixes: `mergeContacts` now repoints
  `email_message_person` and `follow_up_queue_item` onto the survivor, which
  it previously missed, silently losing synced Gmail messages on a merged
  contact (#248); conversations now resolve through every profile key a
  merged person has ever absorbed, at any chain depth, not just its own
  (#243).
- Duplicates-queue tooling: `scripts/merge-duplicates.ts`, an owner-run bulk
  merge CLI with same-mailbox detection (#249); its automatic `dismiss` tier
  was retired after production inspection showed the "two differing verified
  emails means two different people" premise held only 2 times out of 9 —
  dismissal is human-only in `/admin/duplicates` again (#250); three
  confirmed duplicate triangles (9 person rows) collapsed by hand via a
  one-off script (#251). See **Known defects → duplicates queue** for current
  counts.
- Digital Finance Forum 2026 import (#244): 1,001 persons created (9 existing
  matched), 365 companies created (136 matched), 998 phone numbers, all
  assigned to Mariel; CP437/CP850 mojibake repaired on ingest; full
  `--revert` supported.
- Smaller fixes: `pg_net` cron timeout raised to 60s to stop backfill runs
  timing out (#224); inbound Gmail matching now keys on sender only, so a
  contact merely cc'd on automated mail no longer flips to `replied` (#230,
  with `scripts/cleanup-misattributed-inbound.ts` to fix past cases);
  contacts board now fills the viewport with per-column scroll instead of a
  scrollbar far below the fold (#231); developer/sales_bd role groups hidden
  from `/contacts` by default, with an "Ocultos" chip to show them (#229).

## Layer 1 — before the team comes in

These are the things that make the first week survivable.

### launch-readiness
Calls, meetings, tasks and discards are complete, reachable, and have **never
run once** outside a test. Before the team arrives, each needs one real
end-to-end pass against production data by someone who will not forgive a rough
edge. This is not QA theatre — `task.leadId` has full schema, indexes, joins
and rendering with **no write path anywhere** (`createTaskAction` declares
`leadId?: string` but its only caller, `NewTaskButton.tsx`, never passes it;
bulk create never touches it; `TaskEditInput`/`resolveTaskSubject` don't even
have the field), which is exactly the class of gap that only surfaces when a
human tries to use the thing. (Correction: `task.description` is not part of
this gap — it has three live write paths: per-record create
(`NewTaskButton.tsx` → `createTaskAction` → `createTask`), bulk create from the
contacts list (`BulkActionsBar.tsx` → `bulkCreateTaskAction` →
`buildBulkTaskRows` → `bulkCreateTasks`), and edit (`EditTaskDialog.tsx` →
`updateTaskAction` → `updateTaskWithActivity`, commit `fa46a0e`). The earlier
note here predates that commit.)

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
- Mariel cannot connect Gmail yet: Google rejects her with
  `Error 403: org_internal` (2026-09-30). The OAuth app `crm-evolution` has an
  **Internal** consent screen, so only accounts in the Cloud project's own
  Google Workspace organization may authorize it, and hers is not in it —
  either it lives in the separate Workspace created for Calendar/Drive, or she
  signed in with a consumer Google account that merely uses her work address.
  Fix: put her account in the same organization as Cristian and Macarena.
  Do NOT switch the consent screen to External — `gmail.readonly` is a
  restricted scope, so publishing needs Google's security assessment, and
  External+Testing expires refresh tokens every 7 days, which would break her
  sync weekly. (Correction: an earlier note here claimed her mailbox was not
  Gmail. `avalith.net`'s MX is `aspmx.l.google.com`, so it is.)
- Admins now reach another BD's conversation through the audited modal (#232,
  #237); the standalone page was removed.

### email-outbound — owner request 2026-10-01
Owner asked for three things: send mail from the CRM, a per-BD HTML signature
on outgoing mail, and open/engagement notifications "like HubSpot". All three
turned out to share one root blocker, and the first one is already built.

**What already exists.** `src/lib/gmail/send.ts#sendGmailMessage({ bdId, to,
subject, body, personId })` sends through the BD's own connected Gmail account
and is already wired to the record page's "Correo" action
(`src/app/(app)/contacts/actions.ts:365`). `gmail.send` has been in the
requested OAuth scope from the start — `gmail.readonly` was the later addition,
for sync. It logs an activity via `createActivityAction`.

**The blocker all three share.** `buildRawMessage` (`send.ts:20-32`) hardcodes
`Content-Type: text/plain; charset="UTF-8"`. There is no HTML part, so there is
nowhere to put a styled signature and nowhere to put a tracking pixel. Fixing
this is the prerequisite for the two items below: build the message as
`multipart/alternative` with a `text/plain` and a `text/html` part.

Other gaps in the current send path, found while reading it:
- No `In-Reply-To`/`References` headers, so a reply from the CRM starts a NEW
  Gmail thread instead of continuing the conversation the BD is answering.
  This also means the sync side can log it as an unrelated message.
- Single `to` only — no CC, no BCC, no attachments.

Open:
- **HTML send.** `multipart/alternative`, with the plain-text part generated
  from the HTML rather than hand-written twice.
- **Per-BD signature.** The owner has an HTML signature already defined and
  wants it appended by default, with a fallback field in the BD's own profile
  to paste one. There is no column for it today — `bd` is only
  (`id`, `name`, `email`, `role`). Needs a `bd.signature_html` column, a
  profile editor, and injection into the HTML part at send time. Sanitize on
  the way in: it is operator-supplied HTML that goes out over the BD's name.
- **Threading.** Capture the Gmail `Message-ID` of the message being replied
  to (the sync store already has `email_message`) and set the reply headers.
- **Open and click tracking.** Needs the HTML part plus a public,
  unauthenticated pixel endpoint and link rewriting. Be honest about the
  ceiling before building it: Gmail proxies remote images through
  `googleusercontent.com`, so it PREFETCHES them — an "open" can fire without
  a human reading anything, and a recipient who blocks images never fires one.
  HubSpot lives with the same imprecision. Decide up front whether an
  approximate signal is worth a tracking pixel on mail sent over a BD's own
  address, and what it does to deliverability.
- **Notifications.** Where does an open surface — the contact timeline, a
  badge, the daily digest that already exists? Not specified yet.

## Layer 3 — the pipeline nobody is using yet

### owner-reporting — shipped
No longer a mockup: built and merged (#234, BD-filter/drilldown fix #239) —
see **Shipped** above. Discard reasons were already a fixed, validated code
list before this shipped (`wrong_profile`, `not_interested`, `other_vendor`,
`left_company`, `bad_data`, `other`, a note required for `other`), stored in
`activity.metadata` JSONB — queryable but not independently indexed. What the
report still can't show is discards, because production has none recorded
yet (unverified whether that count has changed since the 2026-09-28
inventory).

## Layer 4 — product depth

### admin-email-conversation-access — shipped
No longer a mockup: `getConversationForAdmin` now has a real UI path — the
audited confirm-then-view flow (#232) and the shared `ConversationDialog`
that replaced the standalone page (#237); see **Shipped** above. It serves
synced Gmail threads as well as LinkedIn history, and every view is logged to
`audit_log` before the read.

### auth-security — remaining
- The invite email template still uses the default `{{ .ConfirmationURL }}`.
  Invites are not used today (the owner creates users with a password and Auto
  Confirm); if they ever are, switch it to the token_hash shape first.
- `mailer_autoconfirm` is still on; harmless while sign-ups are disabled.

### timestamptz migration
All timestamp columns are `timestamp without time zone`. Plan:
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md`. Slice 0 (prep,
no schema change) is done and merged (#221). Slices 1–6 — small tables,
imported tables, lead/person, company, activity/task, email/follow-up
tables — are still pending on `main`: confirmed by checking out the plan's
slice list against merged PRs in this pass. (A slice-1 branch with the
22-table conversion written exists in the repo but has not merged as of this
check — treat that as in-flight, not shipped, until it lands on `main`.)
Until slices land, run local checks with `TZ=UTC`.

### click-to-call — research first
Owner request (2026-09-30): evaluate whether a BD can place a call to a
contact from inside the platform.

Why it matters now: the Digital Finance Forum import (#244) added **998 phone
numbers**, and `person.mobile_phone`/`phone` are already surfaced, editable and
exported. Calling is suddenly the channel with the most raw material — and
`activity` has had a `call` type with an `occurredAt` metadata path since the
beginning, yet production holds **zero logged calls**.

What already works, and costs nothing:
- `toTelHref` (`src/lib/phone.ts`) already renders phone rows as `tel:` links on
  the contact record, so a click already dials from a mobile or from any
  desktop softphone. Before buying anything, confirm whether that alone covers
  the need.

What "call from the platform" usually means, in increasing cost:
1. `tel:` links (today) — free, no infra, no automatic logging.
2. Click-to-call through a provider that rings the BD's own phone first and
   then the contact — moderate cost, no browser audio, works from a laptop.
3. A WebRTC softphone in the browser (Twilio Voice, Vonage and similar) — real
   per-minute cost, needs a purchased number, and raises call-recording and
   consent questions under Argentine law.

The valuable part is probably NOT the dialing — it is **automatic call logging**:
a `call` activity written with duration and outcome without the BD having to
remember, which is exactly the step that is failing today (zero calls logged).
A brief should weigh "make logging effortless" against "make dialing possible".

Blocking dependency: the imported numbers are stored raw, mostly 10 digits with
no country code (see the phone decision in this file's Shipped section). Any
provider needs E.164 (`+54 9 ...`), so the normalization question the owner
deferred has to be answered first — and it cannot be answered by digits alone,
since a 10-digit Argentine number does not say whether it is a mobile or a
landline.

Output: a decision brief in `openspec/decisions/` covering the three options
with real pricing, the recording/consent constraint, what changes in the data
model (if anything), and an explicit recommendation — including the honest
option of "the `tel:` link is enough; spend the effort on logging instead".

### linkedin-chrome-extension — ON HOLD (owner decision 2026-09-30)

**Held, not rejected.** The workflow is worth having; there is no way to build
it that satisfies all three of the owner's constraints at once. Recorded in
full so it is not re-litigated from scratch.

What was asked: when a BD connects with someone new on LinkedIn, a modal
offers to push that person into this CRM with name, company and role already
filled — the Apollo-style flow.

What the terms actually say (fetched from linkedin.com/legal/user-agreement,
2026-09-30):

- **§8.2.13** — "Use **bots or other unauthorized automated methods** to
  access the Services, add or download contacts…" — does NOT apply. A human
  clicking a button is not a bot.
- **§8.2.4** — copying information "without the consent of the content owner"
  — turns on the *person's* consent, not LinkedIn's. Arguable either way.
- **§8.2.2** — "Develop, support or use software… (such as crawlers,
  **browser plugins and add-ons**…) **to scrape or copy the Services**" — this
  is the one that binds. The prohibited act is "scrape **or copy**", browser
  plugins are named explicitly, and there is no exception for a single
  user-initiated read. Reading the rendered page is inside it.

How Apollo and its peers actually avoid that: **they do not read the LinkedIn
page.** The extension reads only the URL the user is already on, sends that to
their own backend, and the name/company/title in the modal come from **their
database**, assembled from public sources, user contributions and licensed
providers. That is why they rate as low account risk. It is not a clever
reading of the terms — it is a different data source. (Apollo's own LinkedIn
company page was still removed in early 2025 over data-use policy.)

Which leaves three paths, and only three:

| Path | Cost | Blocker |
| --- | --- | --- |
| BD types the 3 fields | free, ~5s | owner: too much friction at daily volume |
| Extension reads the page DOM | free | §8.2.2; the restricted account is the BD's, and the 3 BDs' accounts *are* the pipeline |
| Enrichment API keyed on the URL | ~USD 0–49/mo at this volume | owner: no external data platforms |

The third is the Apollo model and was costed: Apollo starts at 10k free
credits then USD 49/mo; People Data Labs runs USD 0.20–0.28 per lookup. At
10–30 new contacts a day it fits the free or cheapest tier. **The owner
declined it — no external platforms.** With that constraint, and with the
contacts being people not already in the CRM (so the CRM cannot enrich from
itself), no path remains.

Worth knowing before this is reopened:

- **Proxycurl — the "LinkedIn URL in, profile JSON out" service — shut down
  2025-07-04 after LinkedIn filed a federal suit in January 2025.** The
  page-reading path is not an unwatched grey area; LinkedIn litigates it.
- The surviving real-time scrapers (ScrapIn, Bright Data, Apify) carry the
  same exposure Proxycurl did.
- Enrichment databases are strong in the US and thin in Latin America. Before
  ever paying for one, run 20 real prospects through a free tier and count the
  hits — a modal that says "not found" is worse than no modal, because the
  BD still types everything and has lost the click.

What is still true and cheap, if the workflow is revisited: the CRM already
keys people by normalized `profile_key` (`src/lib/csv.ts`,
`src/lib/identity/matcher.ts`), `createContact` already accepts a
`linkedinUrl` and normalizes it (`src/lib/contacts/createContact.ts:57`), and
`NewContactDialog` already knows how to open prefilled. So the "does this
person already exist?" half needs almost no new code. It is only the "fill in
someone new" half that has no legal, free, self-hosted answer.

**Recommendation, in order — held is not the same as nothing to do.**

1. **Build the free half now, before deciding anything about the paid half.**
   The "does this person already exist?" path costs almost nothing: an
   extension or bookmarklet that carries only the URL, the matcher on
   `profile_key`, and `NewContactDialog` opening prefilled. Zero ToS surface,
   about a day of work. It is also the half that protects the thing that
   actually costs money — 98 duplicate pairs were merged by hand on
   2026-09-30 and 244 remain, and an uncontrolled capture path is exactly how
   that queue refills. Ship this whatever happens to the rest.

2. **Fix the export lag instead of routing around it.** The objection to the
   connections export was that a weekly cadence leaves the CRM stale when BDs
   connect and write the same day. That is an objection to the *cadence*, not
   to the source. LinkedIn's connections archive is requested on demand and
   arrives in minutes, not the days the full archive takes. A BD running it at
   the end of the day closes the gap to hours, and the CRM can prompt it:
   "you added 6 contacts by URL today — run your export to fill them in."
   That is free, sanctioned, self-hosted, and it was dismissed too quickly.

3. **Measure the friction before paying to remove it.** Nobody has counted how
   many new LinkedIn contacts a BD actually adds in a week. At 5–10 a day
   across three BDs, typing name and company is roughly 25–50 minutes a month
   for the whole team — and the BD is looking at the profile they just chose,
   so it is not blind data entry. Run step 1 for a month and count. If typing
   turns out to be the real bottleneck, that is a decision with numbers behind
   it instead of an impression.

4. **The constraint is worth stating precisely, because the current wording
   rules out more than it probably means.** This CRM already depends on
   external platforms — Vercel, Supabase, the Gmail API, the Vercel AI
   Gateway. The line the owner is drawing is almost certainly narrower:
   *our contacts' data must not be handed to a third-party data broker.* That
   is a legitimate and defensible line, and it is not the same as "no external
   platforms". Worth noting that an enrichment lookup sends a **public
   LinkedIn URL** and receives **public professional data** — it does not
   upload the CRM. Whether that crosses the line is the owner's call, but it
   should be decided on the narrow question rather than the broad one, because
   the broad phrasing also rules out things nobody intends to rule out.

None of the above needs a decision today. Step 1 stands on its own.

Superseded: `openspec/decisions/2026-09-30-linkedin-extension-research.md`
(no-go) and `2026-09-30-linkedin-extension-brief.md` (conditional go). Both
kept; this entry records where the decision actually landed and why.

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
  junk. **Shipped 2026-09-30 (#226):** a first-token/compound-given-name rule
  (gated behind the original classifier) split 48 of the remainder in
  production; audit row `person_first_token_split_backfill`, revertible;
  re-run finds 0 left under this rule.
- 233 contacts with no name at all whose email cannot be split reliably
  (`gusoliva@`, `maria.laura.fantoni@`, digits, initials). Needs another
  source (LinkedIn, enrichment) or a BD. (Count not re-verified this pass —
  no database access in this session.)
- Duplicate pairs open in `/admin/duplicates` — see **duplicates queue**
  below; the "11 pairs" figure recorded here previously is stale (see that
  entry for why and for the current count).

### company-contact-counts
The `/companies` list's "Contactos" column and the company record's contacts
card match `person.company_key` directly instead of resolving through
`company_alias`, so both undercount. **Latent today** — `company_alias` is
empty. The fix is written and waiting on the branch
`fix/company-contact-count-alias`; ship it the day an alias is created.

### argentina-day-boundary — shipped
Found by the launch-readiness audit (2026-09-30), fixed and merged the same
day (#247) — see **Shipped** above for the three bugs and their fixes.

### duplicates queue — 244 open, 98 merged, 2 dismissed (2026-09-30)
Previously recorded as 353 open pairs with a recommendation to dismiss 9
pairs whose two sides had different **verified** emails, on the premise that
two differing verified emails mean two different people. **That premise was
wrong far more often than it was right:** every pair that ever landed in that
bucket was inspected by hand against production, and it held 2 times out of
9 — the 7 misses were a ccTLD suffix, a dot separator, a middle initial, an
accented local part, a typo, a short form beside a full one, and a personal
address beside a work one (PR #249, #250; commits `7ffe9f4`, `530c606`). The
automatic `dismiss` tier has been **retired**: `scripts/merge-duplicates.ts
--tier=dismiss` now exits 1 with a pointer to `/admin/duplicates` — dismissal
is a human judgement call there again, with no automation.

Current counts, measured read-only against production after the last run:
**244 open, 98 merged, 2 dismissed**; 27,528 active contacts. The merges came
in four passes — 70 and 4 by `scripts/merge-duplicates.ts --tier=safe` (runs
`e4f4a779`, `d097caed`), then 3 and 5 confirmed triangles by
`scripts/merge-triangles-2026-09.ts` (batches "a" and "b", PR #251 and its
follow-up). The 2 dismissals were run `de3d64b7`, before the tier was retired;
both were verified by hand first as genuinely different people
(`juan.barrere`/`juan.vespa@pampaenergia.com`,
`jose.tanaka`/`jose.somale@tecpetrol.com` — different surname tokens in the
local part, which is the signal that actually separates the two groups).

Bucket breakdown of the 244 open pairs, from a `--tier=safe` dry run:

| Bucket | Pairs | Why it is not automatic |
| --- | --- | --- |
| `classic_split_no_conflict` | 0 | all cleared |
| `classic_split_conflict` | 71 | job title or owner disagree |
| `one_email_not_classic` | 20 | one email, no complementary LinkedIn row |
| `two_emails_differ_unverified` | 8 | neither side verified |
| `no_email_titles_agree` | 46 | no email on either side |
| `no_email_titles_conflict` | 109 | no email AND the titles contradict |

The last two rows are the bulk of the queue: **155 pairs where neither side
has an email at all**, matched only on name plus company, and 109 of those
also have contradicting job titles. Those are as likely to be namesakes as
duplicates — the `juan.barrere`/`juan.vespa` pair above was exactly this
shape and was only settled because both sides happened to have an email. A
wrong merge puts one person's activity on another person's record, which is
worse than leaving the pair open, so these need a human with account
knowledge, not a rule.

Note the recurring trap: the `classic_split_no_conflict` bucket repeatedly
reports as tier `safe` and is then skipped entirely, because every one of its
pairs sits in a closed triangle (3 rows, all 3 pairs open) and the bulk CLI
refuses any pair whose person appears in another open pair. Those are handled
by `scripts/merge-triangles-2026-09.ts`, which takes explicit person ids and
a `--batch=` name.

Merging preserves activities,
tasks, connections and conversations, and is reversible with no time limit
via `--revert=<runId>`.

### merges dropped phone numbers — 35 contacts, data is recoverable (2026-10-01)
Found while investigating the owner's report that the contacts list showed
people with no phone. The filter bug was separate (see
`fix/contacts-hasphone-filter-dropped`); this is the other half, and it is
worse, because it is silent data loss.

`person.phone` and `person.mobile_phone` are evidently NOT in `TRACKED_FIELDS`
(`src/lib/identity/merge.ts`), so a merge never copies them onto the survivor.
Same class as the `profileKey` finding already recorded for survivor choice.

Measured against production on 2026-10-01:
- 98 rows have `merged_into_id` set.
- **35 survivors have no phone at all while the row merged INTO them does.**
  Over a third of every merge performed.

Examples (survivor → the number stranded on the merged-away row):
- Tito Picón → `+54 (11) 4118 8080` / `+54 (911) 6213 0024` (owner: Cristian)
- Mariano Ortega → `+54 9 11 4590-2294` (owner: Cristian)
- Roberto Arón Uauy Zirinsky → `994489460` (owner: Mariel)
- Nicolas Finelli → `+1 (954) 837-6436` (owner: Macarena)
- Andrés Kemeny → `+56 2 2938 0805` (owner: Cristian)

Two pieces of work, and they are independent:
1. **Recover the 35.** The data is still there on the merged-away rows, so a
   one-off backfill can restore it: for each survivor with an empty phone,
   take the merged-away row's value. Low risk — it only ever fills a blank.
   Needs an owner decision on precedence when several merged rows disagree.
2. **Stop it recurring.** Add both phone columns to `TRACKED_FIELDS` so a
   merge carries them. Then audit the REST of `person`'s columns the same way:
   this bug was found by accident, and `profileKey` was found by accident, so
   the real defect is that nothing asserts which columns a merge must carry.
   A test that enumerates `person`'s columns and forces an explicit
   carry/do-not-carry decision for each would have caught both.

**Note for the 244 still-open duplicate pairs:** merging any of them today
still loses the phone. Fix item 2 before working the queue further.

### pickEmailWinnerSide is a hand-copy, not a shared function
`pickEmailWinnerSide` in `src/lib/identity/duplicateTiering.ts` duplicates the
private `mergeEmailFields` rule in `src/lib/identity/merge.ts` by hand,
because the original is not exported. It only drives the dry-run report in
`scripts/merge-duplicates.ts`, so a divergence between the two would mislead
the operator reading the report rather than corrupt any written data — the
actual merge still goes through `mergeEmailFields` itself. Verified to agree
with reality on all 4 merges of run `d097caed` (source: PR #249, "Known
debt"). Note: another agent may be working on this right now; recorded here
as outstanding debt regardless, for reconciliation.

### task.contactId — dead legacy column, no user-facing impact
Same shape as `task.leadId` above, but lower priority since no user can reach
it: `task.contactId` (`src/db/schema.ts:1157`, indexed as `task_contact_idx`
at `schema.ts:1180`) is selected and joined on every task read
(`src/lib/tasks/queries.ts`), but no write path ever sets it — `createTaskAction`
declares it in its input type, but its only caller never passes it, and bulk
create never touches it. Unlike `leadId`, it isn't even in
`TaskSubjectInput` (`src/lib/tasks/subject.ts`), so no renderer consults it
either. Both `leadId` and `contactId` are pre-Unified-Contact legacy columns
superseded by `personId`. Open question, not a recommendation: delete the
columns, or build a lead/contact subject picker — owner's call; a picker
would need a mockup first.

### task creation writes no activity row
`createTask` and `bulkCreateTasks` write **no** `task_created` activity —
documented deliberately at `src/lib/tasks/bulkCreateDb.ts:20-24`. Only edit,
completion and reopening log an `activity` row naming the actor
(`updateTaskWithActivity`). Worth recording plainly: the project rule "every
task change logs an activity naming the actor" currently applies to
edit/complete/reopen but not to creation, and that asymmetry is easy to
mistake for a bug later if no one writes down that it's intentional.

### unit-test flake, unattributed
One unreproducible unit-test failure was observed in 1 of 18 consecutive
suite runs on 2026-09-30. It could not be attributed to a specific test name
in 17 further runs — i.e. it has not recurred since, and no failing test name
was identified when it did occur. Not independently reproduced or
investigated further in this pass.

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
