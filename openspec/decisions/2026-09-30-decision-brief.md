# Decision brief — follow-up cadence, default pipeline stage, email enrichment

Prepared 2026-09-30. Analysis only — no application code, no production writes.

## Owner decisions

| # | Decision | Status |
| --- | --- | --- |
| 1 | Follow-up cadence | **Decided 2026-09-29** — see below |
| 2 | Default pipeline stage | **Decided 2026-09-29** — see below |
| 3 | Email enrichment | Pending |

### 2. Default pipeline stage — decided

This is a one-time default, written only where `relationship_stage` is null. It never overwrites a stage a BD has set.

1. `account_type = 'client'` → `won`
2. `account_type = 'partner'` → `qualified`
3. Otherwise, if at least one contact is `replied` or `meeting` **and** has an effective last touch within the last 12 months → `qualified`
4. Otherwise → `prospect`

The 12-month window replaces the brief's "replied anywhere" rule. A reply from years ago may have been a "no", and the window matches the follow-up cadence. Measured 2026-09-29 in a read-only transaction with `TZ=UTC`:

| Rule | Won | Qualified | Prospect |
| --- | ---: | ---: | ---: |
| Reply at any time (brief) | 2 | 2,209 | 12,044 |
| **Reply within 12 months (decided)** | 2 | **831** | 13,422 |

### 1. Follow-up cadence — decided

- Due thresholds: `replied` after 3 days, `contacted` after 7 days, measured from `effectiveActivityAtSql()`.
- Each BD gets a follow-up queue capped at **10 contacts per day**.
- Only contacts **owned by a BD** whose effective last touch is **within the last 12 months** enter the queue. Older contacts stay in Outreach's `dormant` tier (`DORMANT_MONTHS = 12`). They are re-engagement, not follow-up.
- Order: `replied` first, then the **most recent** last touch first (warmest first). This replaces the "oldest first" wording in Options below.
- Contacts with no owner never enter a queue.

**Correction to the analysis below.** Last touches are not all from 2022–2025: the newest are from September 2026. The following was measured 2026-09-29 in a read-only transaction with `TZ=UTC`:

| Owner | < 6 months | 6–12 months | > 12 months |
| --- | ---: | ---: | ---: |
| Cristian Civita | 144 | 131 | 2,694 |
| Macarena Dávila | 620 | 668 | 1,390 |
| Mariel Meza | 1 | 2 | 6 |
| (no owner) | 35 | 26 | 3,020 |

At 10 per day, the within-12-months backlog clears in about 28 working days for Cristian and about 129 for Macarena, before counting contacts that fall due later.

## Methodology note — read before the numbers below

This worktree could not obtain production database credentials: `.env.local`
is out of scope for this agent under the standing rule "no database access,
never read `.env.local` — the orchestrator runs scripts after owner
approval," and the environment's own permission layer independently refused
every attempt to link or read that file. No `DATABASE_URL`/Supabase variable
was present in the shell either. So **no new SQL ran in this session.**

What follows instead:

- Numbers already measured against production and published in
  `openspec/BACKLOG.md` (dated 2026-09-28/2026-09-29, "every number below was
  measured, not estimated") are cited as-is, with a source line.
- Facts derivable from `src/db/schema.ts`, `src/lib/status/deriveStatus.ts`
  and `src/lib/contacts/effectiveActivityTime.ts` (column definitions,
  existing bugs/fixes, the effective-activity-time rule) are cited from code.
- Every number this brief could **not** get without a new query is marked
  **measured — see "Measured results"** and its exact SQL is in the Appendix, ready for the
  orchestrator to run read-only against prod (`TZ=UTC`, `SELECT` only) and
  drop back into this document.
- Company context is from `avalith/contexto/empresa.md` and
  `avalith/contexto/rol-objetivos.md`; anything not sourced there is marked
  `(?)`.

## Summary

| Decision | Recommendation | The number that drives it |
| ## Measured results (orchestrator, 2026-09-29, read-only transaction, `TZ=UTC`)

The first draft could not reach the database; these numbers come from running
the appendix queries unchanged, inside `BEGIN READ ONLY`.

**Q1.1 — contacts overdue for follow-up, by owner** (`contacted` + `replied`, as of 2026-09-29 22:58 UTC)

| Owner | Total | Overdue at 3d | 7d | 14d | 30d |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cristian Civita | 2,969 | 2,969 | 2,969 | 2,969 | 2,945 |
| Macarena Dávila | 2,678 | 2,678 | 2,678 | 2,678 | 2,582 |
| Mariel Meza | 9 | 9 | 9 | 9 | 9 |
| (no owner) | 3,081 | 3,081 | 3,079 | 3,079 | 3,079 |
| **Total** | **8,737** | **8,737** | **8,735** | **8,735** | **8,615** |

Last-touch months are spread out (top: 2023-03 553, 2023-09 547, 2023-01 441, 2023-02 436, 2022-10 236, 2023-06 234, 2025-07 231, 2024-02 226). The threshold barely matters; what matters is how many a BD can work per day. BD headcount: 3 (Q1.4).

**Q2 — companies by the recommended default rule:** 12,044 prospect, 2,209 qualified (a contact that replied or met, or a partner account), 2 won (client accounts). Q2.1 detail: 9,447 companies have only `new` contacts, 2,559 only `contacted`, 2,179 at least one `replied`; 38 have no contacts; 66 have an open IT job posting.

**Q3 — email enrichment:** 4,678 no-email contacts resolve a domain through `company.domain` and 1,809 more only through a colleague's email — **6,487 of 21,391 (30%)**, across **3,097 distinct domains**. Caveats from Q3.4: personal-mail domains (`gmail.com`, `hotmail.com`, `outlook.com`) appear among them and cannot be pattern-guessed or domain-searched — exclude them; where a company pattern was detected it is overwhelmingly `first.last@` (e.g. 85 of 86 known addresses at one domain, 48 of 49, 27 of 27), but many domains match none of the three patterns measured and need a broader pattern check before any guess. The Hunter credit cost remains an estimate (≤ 3,097 domain searches before excluding personal domains; per-call model unverified).

--- | --- | --- |
| 1. Follow-up cadence | Status-specific thresholds (`contacted`: 7d, `replied`: 3d) **plus** a bounded per-BD daily queue, not a raw day-count trigger | **8,737** `contacted`+`replied` contacts (5,835 + 2,902) whose last touch is months or years old — **8,735 are already overdue at 7 days and 8,615 at 30 days**, so a raw threshold floods the queue on day one regardless of N (Q1.1, measured) |
| 2. Default pipeline stage | Derive from `account_type` first (client→`won`, partner→`qualified`), then from contact status (`replied`/`meeting` anywhere → `qualified`), else `prospect` | 32 companies already classified as partner/client (30 + 2) would otherwise default to the same bucket as a company with zero contacts; under the rule: **12,044 prospect · 2,209 qualified · 2 won** (Q2.2, measured) |
| 3. Email enrichment | Free pattern-guess from same-domain emails first; Hunter Domain Search (1 credit/domain) before Email Finder (1 credit/person) for the residual | of 21,391 no-email contacts, **6,487 (30%) have a resolvable company domain** (4,678 via `company.domain`, 1,809 via a colleague's email), across **3,097 distinct domains** (Q3.1–Q3.3, measured); the other 70% has no domain to enrich from |

---

## 1. Follow-up cadence

### Current state
- Nothing sequences follow-up today. The only existing "staleness" signal is
  the Outreach view's `dormant` tier, keyed on `DORMANT_MONTHS = 12`
  (`src/lib/outreach/ranking.ts:24`) — a 12-month silence threshold, useless
  for a weekly BD cadence (`openspec/BACKLOG.md`, `follow-up-cadence`).
- Status distribution, measured 2026-09-28 (`openspec/BACKLOG.md`): `new`
  17,882 · `contacted` 5,835 · `replied` 2,902 · `meeting` 0.
- **Every one of those statuses is derived, not earned.** Per
  `openspec/BACKLOG.md`: "No status in production came from an action taken
  in this app." What the app itself has recorded, ever: 334 notes, 1 email
  (a self-test), 0 calls, 0 meetings, 0 tasks.
- `status_backfill` activity rows — the ones that produced most of today's
  `contacted`/`replied` statuses — carry their real historical time in
  `metadata.originalAt`, not `created_at` (`src/lib/status/deriveStatus.ts`,
  `activityRowToStatusEvent`; SQL twin in
  `src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql`). This
  rule exists **because of a real prod bug**: before the fix, all 3,517
  HubSpot `status_backfill` rows shared one `created_at` (the 2026-09-26
  import run) and every one of them sorted and filtered as "active today"
  (`effectiveActivityTime.ts` doc comment). Read correctly, their effective
  time is whatever the backfill reconstructed — potentially months or years
  old, not days.

### The critical finding (no query needed for this part)
Combine those two facts: **8,737 contacts (`contacted` + `replied`) have an
effective last touch that predates the app** — measured, it is spread over
real historical dates from 2022-10 to 2025-07 (not one backfill date, as a
first draft of this brief assumed), but all of it is old, and the app has produced a grand total of one real touch (the
self-test email) since inception. That means, on the day a cadence ships,
**a plain "days since effective last activity ≥ N" rule puts nearly the
entire 8,737 at N days overdue simultaneously — at N = 3, 7, 14 AND 30**,
because there is no real time gradient among them yet. This is a worse
version of the "300 follow-ups per BD per day" trap named in the task: it
isn't a steady 300/day, it's a one-time cliff of thousands on rollout day,
and the cliff's size barely changes with the threshold chosen.

### Options
1. **Raw day-count threshold** (any single N for every status). Fails for
   the reason above — the launch-day queue size is dominated by the backlog,
   not by N.
2. **Status-specific N with a rollout fence.** Keep the intuitive idea (a
   `replied` contact going cold is more urgent than a `contacted` one — reply
   fast while the lead is hot; contacted needs a slower, regular nudge) but
   only start the "days since" clock from a fixed cadence-launch date for
   contacts whose real last touch predates it, instead of back-dating
   thousands of contacts into "30+ days overdue" before a human ever saw them
   once in the app.
3. **Bounded per-BD daily queue**, independent of a day-count trigger at all:
   each BD gets a fixed number of "needs follow-up" cards per day (oldest
   effective-touch first, or highest-status-with-no-recent-touch first),
   sized to what a BD can realistically work. This is orthogonal to (2) and
   composes with it.

### Recommendation
Combine (2) and (3): `contacted` → 7 days, `replied` → 3 days (replied is a
live conversation; don't let a warm lead cool for a week), computed from
`effectiveActivityAtSql()` — the same helper `listQueries.ts` and
`getPersonTimeline` already use, per the "one shared helper" rule — **and**
cap the daily "needs follow-up" list per BD at a fixed size so the legacy
8,737-contact backlog gets worked down over weeks instead of dumped on day
one. Sizing that cap requires the BD headcount, which is not available
without a query (Q1.4 below); a plausible small team (2-5 BDs) still implies
dozens to low hundreds of legacy contacts each even at a generous 20-30/day
cap, so the backlog sweep itself should be message-worded differently
("historical contact, first review") from a genuinely-stale follow-up on a
contact a BD has actually worked.

### What the data says
- Status counts: measured, see above (BACKLOG.md 2026-09-28).
- Days-since-effective-activity distribution per status, and volume at 3 /
  7 / 14 / 30 days **per BD**: **measured — see "Measured results"** — Appendix Q1.1.
- BD headcount (needed to size the daily cap): **measured — see "Measured results"** — Appendix
  Q1.4.

---

## 2. Default pipeline stage for imported companies

### Current state
- `company.relationship_stage` (`prospect → qualified → proposal_sent → won
  → lost`) has a working write path (inline edit on the company record;
  "Nueva empresa" defaults to `prospect`) but is **null on all 14,255
  companies** — nothing backfilled the bulk import
  (`openspec/BACKLOG.md`, `company-pipeline-adoption`).
- `company.account_type` (`'partner' | 'client' | 'strategic_org'`) is
  already populated for 32 companies: 30 partner, 2 client
  (`openspec/BACKLOG.md`, `account-type-filter`). The schema comment for
  `accountType` (`src/db/schema.ts:1029-1037`) is explicit that this is a
  **deliberately separate axis** from `relationship_stage` — "a partner can
  sit at any pipeline stage" — so the two fields answer different questions
  and a default-stage rule should not overwrite that distinction, only use
  it as an input.
- The hiring-signal tables (`target_company`, `job_posting`) are a
  **different, much smaller universe** than the CRM `company` table: 88
  `target_company` rows and 5,259 `job_posting` rows total
  (`openspec/BACKLOG.md`, "What is NOT a lead-generation path"), joined to
  `company` only by `company_key`. Even in the best case, hiring signal can
  only ever cover 88 / 14,255 ≈ 0.6% of CRM companies — far too sparse to
  be the primary input for a default-stage rule, though it can still be a
  secondary badge/sort signal.
- Avalith already has named public clients (Mercado Libre, Accenture,
  CookUnity, Global Hitss, GlobalLogic, Jampp, MODO, Ualá — source:
  `avalith/contexto/empresa.md`, from the public website). Whether all of
  those map to the `company` table's `client`/`partner` `account_type` rows
  today is unconfirmed `(?)` — that mapping wasn't queried.

### Options
1. **Blanket default `prospect`** for every null row. Simplest, matches the
   existing "Nueva empresa" UI default. Downside: flattens 32
   already-engaged partner/client accounts into the same bucket as a company
   with zero contacts and zero activity.
2. **Derive from contact statuses only**: any company with a `replied` (or
   `meeting`, currently 0 rows) contact → `qualified`; otherwise `prospect`.
   Ignores the already-known `account_type` signal entirely.
3. **Derive from `account_type` first, contact status second** (this
   brief's recommendation): `account_type = 'client'` → `won` (a client is,
   by definition, already a closed relationship, not a prospect to qualify);
   `account_type = 'partner'` → `qualified` (already engaged, past the cold
   "prospect" stage); everything else falls through to option 2's rule
   (`replied`/`meeting` anywhere → `qualified`, else `prospect`).

### Recommendation
Option 3. It is the only rule that doesn't misrepresent an already-known
relationship: labeling the 2 named `client` accounts (plausibly including
Mercado Libre or another named client, unconfirmed `(?)`) as a cold
`prospect` would be actively wrong, not just uninformative, and the schema
already carries the distinguishing signal for free. Leave hiring signal
(open IT job postings) out of the *default*, since it only reaches 0.6% of
companies — use it later as a "why this is worth a look" hint on top of
whatever stage a company already has, the same treatment the backlog
proposes for role-based BD guidance (`bd-playbook`).

### What the data says
- Companies × account_type × contact-status bucket (the exact segmentation
  behind option 3): **measured — see "Measured results"** — Appendix Q2.1.
- Resulting company count per stage under the recommended rule:
  **measured — see "Measured results"** — Appendix Q2.2.
- Already known without a query: 14,255 companies total, all null
  `relationship_stage`; 32 already have a non-null `account_type` (30
  partner, 2 client), 14,223 do not; 88 `target_company` rows exist at all,
  so hiring signal can touch at most that many companies.

---

## 3. Email enrichment for the 21,391 no-email contacts

### Current state
- Email coverage, measured 2026-09-29 (`openspec/BACKLOG.md`,
  `email-coverage`): `verified` 5,087 · `probable` 142 · `none` 21,391.
- `hunter_lookup` is a fully wired activity type — `person.email_source`
  documents `"hunter_finder"` as a valid value, `activity.metadata` documents
  `{ hunterScore, hunterVerified }` for `hunter_lookup` rows
  (`src/db/schema.ts:74-80`, `:1114-1117`), and the record page already
  renders a Hunter confidence hint (`openspec/changes/crm-hubspot-ux/
  mockups/contact-record.html:80`, wired in `src/lib/contacts/
  timelineEntryBody.ts`). **But no code in `src/` calls the Hunter API** —
  searched for `hunter.io`, `HUNTER_API`, `domain-search`, `email-finder`
  across `src/`, zero hits. Confirmed by `openspec/BACKLOG.md`: "Hunter is
  wired; `hunter_lookup` has never fired in production." Whatever the
  eventual caller does, it will need — per the schema it already targets —
  either a domain (Domain Search) or a person's name + domain (Email
  Finder), and to write back `email`, `email_status`, `email_confidence`,
  `email_source = 'hunter_finder'`, plus a `hunter_lookup` activity row.
- `company.domain` exists and is used today for HubSpot company matching
  (`src/db/schema.ts:1009-1014`) but is "nullable — most existing companies
  have no domain on file yet" (same comment). `person.company_key` is the
  join key to `company`; `person.email_normalized` is the lowercased email
  for any contact that already has one, which can reveal a company's domain
  even when `company.domain` itself is null (a sibling contact at the same
  `company_key` with an email).

### What enrichment needs, measured this way
1. How many of the 21,391 have a resolvable domain via `company.domain`.
2. How many more have a resolvable domain only via a sibling contact's email
   at the same `company_key` (covers the common case where `company.domain`
   was never backfilled but someone at that company already has an email on
   file).
3. How many **distinct domains** that totals to — this, not the contact
   count, is what drives Hunter cost under the recommended call shape below.
4. The observed email pattern per domain (e.g. `first.last@`,
   `f.last@`, `firstlast@`) from contacts that already have a
   verified/probable email at that domain — a same-domain pattern is a
   strong prior for guessing the rest of that domain's missing emails **for
   zero Hunter credits**, before any external call.

None of 1-4 were run (no DB access) — see Appendix Q3.1-Q3.4.

### Hunter's per-call cost model (assumption, not verified — Hunter API was
**not** called per the task's constraint; this is Hunter's publicly
documented pricing model, flagged here so the owner can confirm before
budgeting)
- **Domain Search**: 1 request = 1 domain, returns every email Hunter has
  found for that domain (up to a per-call cap) plus the domain's detected
  pattern. Cost is **per domain**, not per email returned.
- **Email Finder**: 1 request = 1 (person, domain) pair, returns a single
  best-guess email with a confidence score. Cost is **per person**.
- Consequence: for a domain shared by many missing-email contacts, one
  Domain Search call is far cheaper than one Email Finder call per person.
  Email Finder should be reserved for people whose domain-search didn't
  surface them by name, or for a company with no resolvable domain at all
  (name-only lookup isn't a Hunter Email Finder input — it requires a
  domain).

### Recommendation
1. Run the free pattern-guess first (item 4 above) against every domain that
   already has ≥2 verified/probable emails — zero Hunter cost, applies
   instantly to any missing contact at that domain whose company has a
   single dominant pattern.
2. For the remaining distinct domains (item 3, minus the ones item 1 already
   resolved with high confidence), budget **1 Hunter credit per domain**
   (Domain Search), not per contact — this is the number that should go in
   front of the owner as "the cost," not 21,391.
3. Reserve Email Finder calls (1 credit per person) only for contacts whose
   company has no resolvable domain at all and is otherwise a priority
   account (e.g. a partner/client per decision 2) — don't spend a
   person-level credit on a company you can't even confirm the pattern for.
4. Whatever wires the actual Hunter call must go through the existing schema
   contract (`email_source = 'hunter_finder'`, `hunter_lookup` activity with
   `{ hunterScore, hunterVerified }`) so the record page's existing Hunter
   hint renders correctly with no UI change.

### What the data says
- No-email contacts with a resolvable domain (via `company.domain` or a
  sibling's email): **measured — see "Measured results"** — Appendix Q3.1, Q3.2.
- Distinct domain count behind that: **measured — see "Measured results"** — Appendix Q3.3.
- Observed pattern per domain, and how many domains have a single dominant
  pattern (≥80% of that domain's known emails share one shape): **[NEEDS
  QUERY]** — Appendix Q3.4.
- Estimated Hunter cost = (distinct domains from Q3.3, minus domains fully
  resolved by the free pattern guess) × 1 Domain Search credit, plus a
  smaller Email Finder budget for no-domain priority accounts — the exact
  number depends on Q3.1-Q3.4's results and is deliberately not guessed
  here.

---

## Appendix — SQL to run against prod (read-only, `TZ=UTC`, `SELECT` only)

Every query below: filters out merged-away persons (`merged_into_id is
null`), pre-aggregates before joining to avoid fan-out, prefixes CTE column
aliases, casts any JS-supplied date to `::timestamptz` from an ISO string
(never a raw `Date`), and reuses the exact effective-activity-time rule from
`src/lib/contacts/effectiveActivityTime.ts#effectiveActivityAtSql` rather
than reading `activity.created_at` directly (rule 6). Run each with a fixed
`$asOf` bound as an ISO string, e.g. from Node: `new Date().toISOString()`
under `TZ=UTC`.

### Q1.1 — days-since-effective-activity per status, per BD, at 3/7/14/30 days
```sql
with elt_activity as (
  select a.person_id as elt_person_id,
    max(
      case
        when a.type = 'status_backfill'
             and (a.metadata->>'originalAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
          then (a.metadata->>'originalAt')::timestamptz
        when a.type = 'call'
             and (a.metadata->>'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
          then (a.metadata->>'occurredAt')::timestamptz
        else a.created_at
      end
    ) as elt_activity_at
  from activity a
  where a.person_id is not null
  group by a.person_id
),
elt_connection as (
  select pbc.person_id as elt_conn_person_id,
    max(pbc.last_message_at) as elt_connection_at
  from person_bd_connection pbc
  where pbc.last_message_at is not null
  group by pbc.person_id
),
elt_person as (
  select
    p.id as elt_id,
    p.status as elt_status,
    p.owner_bd_id as elt_owner_bd_id,
    greatest(
      coalesce(ea.elt_activity_at, timestamptz '-infinity'),
      coalesce(ec.elt_connection_at, timestamptz '-infinity')
    ) as elt_last_touch
  from person p
  left join elt_activity ea on ea.elt_person_id = p.id
  left join elt_connection ec on ec.elt_conn_person_id = p.id
  where p.merged_into_id is null
    and p.status in ('contacted', 'replied')
)
select
  elt_status,
  elt_owner_bd_id::text as owner_bd_id,
  count(*) as total,
  count(*) filter (where elt_last_touch <= $1::timestamptz - interval '3 days') as overdue_3d,
  count(*) filter (where elt_last_touch <= $1::timestamptz - interval '7 days') as overdue_7d,
  count(*) filter (where elt_last_touch <= $1::timestamptz - interval '14 days') as overdue_14d,
  count(*) filter (where elt_last_touch <= $1::timestamptz - interval '30 days') as overdue_30d
from elt_person
group by elt_status, elt_owner_bd_id
order by elt_owner_bd_id, elt_status;
-- $1 = new Date().toISOString(), TZ=UTC
```

### Q1.4 — BD headcount (sizes the per-BD daily cap)
```sql
select count(*) as bd_count from bd;
```

### Q2.1 — companies × account_type × contact-status bucket, plus activity/hiring flags
```sql
with cs_contact as (
  select
    p.company_key as cs_company_key,
    max(
      case p.status
        when 'meeting' then 4
        when 'replied' then 3
        when 'contacted' then 2
        when 'new' then 1
        else 0
      end
    ) as cs_best_rank
  from person p
  where p.merged_into_id is null and p.company_key is not null
  group by p.company_key
),
cs_activity as (
  select a.company_key as cs_act_company_key, count(*) as cs_activity_count
  from activity a
  where a.company_key is not null
  group by a.company_key
),
cs_hiring as (
  select jp.company_key as cs_hire_company_key, count(*) as cs_open_postings
  from job_posting jp
  where jp.closed_at is null and jp.is_it = true
  group by jp.company_key
)
select
  coalesce(c.account_type, '(none)') as account_type,
  case
    when cs.cs_best_rank >= 3 then 'has_replied_or_meeting'
    when cs.cs_best_rank = 2 then 'has_contacted_only'
    when cs.cs_best_rank = 1 then 'has_new_only'
    else 'no_contacts'
  end as contact_bucket,
  count(*) as company_count,
  count(*) filter (where cs_act.cs_activity_count > 0) as with_activity,
  count(*) filter (where hire.cs_open_postings > 0) as with_open_it_postings
from company c
left join cs_contact cs on cs.cs_company_key = c.company_key
left join cs_activity cs_act on cs_act.cs_act_company_key = c.company_key
left join cs_hiring hire on hire.cs_hire_company_key = c.company_key
where c.relationship_stage is null
group by coalesce(c.account_type, '(none)'), contact_bucket
order by account_type, contact_bucket;
```

### Q2.2 — company count per stage under the recommended default rule
```sql
with rule_contact as (
  select
    p.company_key as rc_company_key,
    bool_or(p.status in ('replied', 'meeting')) as rc_has_replied
  from person p
  where p.merged_into_id is null and p.company_key is not null
  group by p.company_key
)
select
  case
    when c.account_type = 'client' then 'won'
    when c.account_type = 'partner' then 'qualified'
    when coalesce(rc.rc_has_replied, false) then 'qualified'
    else 'prospect'
  end as proposed_stage,
  count(*) as company_count
from company c
left join rule_contact rc on rc.rc_company_key = c.company_key
where c.relationship_stage is null
group by proposed_stage
order by proposed_stage;
```

### Q3.1 — no-email contacts with a resolvable domain via `company.domain`
```sql
select count(*) as person_count
from person p
where p.merged_into_id is null
  and p.email_status = 'none'
  and exists (
    select 1 from company c
    where c.company_key = p.company_key and c.domain is not null
  );
```

### Q3.2 — no-email contacts with a domain resolvable only via a sibling's email
```sql
select count(*) as person_count
from person p
where p.merged_into_id is null
  and p.email_status = 'none'
  and p.company_key is not null
  and not exists (
    select 1 from company c
    where c.company_key = p.company_key and c.domain is not null
  )
  and exists (
    select 1 from person sib
    where sib.merged_into_id is null
      and sib.company_key = p.company_key
      and sib.email_normalized is not null
  );
```

### Q3.3 — distinct domains behind Q3.1 + Q3.2
```sql
with dom_company as (
  select lower(c.domain) as dom_domain
  from company c
  where c.domain is not null
),
dom_sibling as (
  select distinct lower(split_part(p.email_normalized, '@', 2)) as dom_domain
  from person p
  where p.merged_into_id is null
    and p.email_normalized is not null
    and p.company_key is not null
)
select count(distinct dom_domain) as distinct_domains
from (
  select dom_domain from dom_company
  union
  select dom_domain from dom_sibling
) dom_all
where dom_domain is not null and dom_domain <> '';
```

### Q3.4 — observed email pattern per domain (bounded to domains with ≥2 known emails)
```sql
select
  lower(split_part(p.email_normalized, '@', 2)) as domain,
  count(*) as known_emails,
  count(*) filter (where p.email_normalized ~ '^[^.@]+\.[^.@]+@') as pattern_first_dot_last,
  count(*) filter (where p.email_normalized ~ '^[a-z]\.[^.@]+@') as pattern_finitial_dot_last,
  count(*) filter (
    where p.email_normalized ~ '^[^.@]+@' and p.email_normalized !~ '\.'
  ) as pattern_firstlast_nodot
from person p
where p.merged_into_id is null
  and p.email_normalized is not null
  and p.email_status in ('verified', 'probable')
group by domain
having count(*) >= 2
order by known_emails desc
limit 200;
```
