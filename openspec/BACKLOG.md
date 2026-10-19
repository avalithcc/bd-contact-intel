# Backlog

Ordered by what unblocks what, not by how much anyone wants it. The question this
list answers is **what has to be true before the BD team is let in**, because the
app is finished enough to look ready and — until 2026-09-30 — had never been
used by anyone.

Inventoried against production on 2026-09-28. Refreshed 2026-09-30 against PRs
#198–#223 (Seguimientos queue, email sync, task edit/bulk create, pipeline
backfill, account-type filter, playbook, DMARC fix). Re-verified 2026-09-30
against PRs #224–#251 (Argentina timezone fixes, owner reports, audited admin
conversation access, company search, Digital Finance Forum import, remaining
name splits, duplicates-queue tooling).

**Reconciled 2026-10-01 against `main` at `eb83593` (PRs #252–#292) and a
read-only pass over production** (measured 2026-10-01 evening Argentina time,
2026-10-02 01:39 UTC). The previous version of this file had more than twenty
claims that were false or stale (the list is in the PR that made this pass);
each corrected entry carries a short
"(Corrected 2026-10-01: …)" note so the next reader sees it was checked. Rule
for this file from now on: **every count carries the date it was measured,
every code claim carries `file:line`, and anything not re-checked says
"unverified".** Where a figure has no date, treat it as unverified.

**Partially updated 2026-10-03 against `main` at `c79f7b6` (PRs #307–#317).**
This update was NOT another full reconciliation. Only two things were rewritten:
the **Layer 1 → launch-readiness** entry, which asked for an end-to-end pass
that has since been run and whose 14 findings are all closed, and the
**Shipped** list. **No production figure in this file was re-measured on
2026-10-03** — every count below still carries its 2026-10-01 measurement date
and should be read as that old, including the row counts, the duplicates queue
and the per-feature usage table. Treat them as unverified at today's date.

## Where we actually are

Almost everything in the database arrived by import, but it is **no longer
true that nothing was produced by a BD working in the app**: since 2026-09-30
Mariel and Macarena have logged calls, meetings, tasks, a discard, notes and
company stage changes (table below). The earlier line "the team was told to
stay out while it is in development" is an owner instruction not verifiable
from data; the data shows it no longer holds.

| Source (`person.source_key`) | Rows | Note |
| --- | --- | --- |
| `linkedin_import` (now hidden from the UI) | 19,684 | |
| `hubspot_import` (one run, 2026-09-26) | 5,867 | 98 of these rows were merged away and are hidden |
| leads CSV (`fi-arg-2026`) | 1,053 | |
| `dff-2026` (Digital Finance Forum, #244) | 1,001 | all owned by Mariel |
| `hoteles-2026-10` (hotel sheet, #273) | 147 | all owned by Mariel |
| `partner_account_notes` (curated, by script) | 16 | |
| `manual` (created in the app by a BD) | 13 | Cristian 1, Macarena 6, Mariel 6 |
| **total rows** | **27,781** | **27,683 live** (excluding 98 merged away); measured 2026-10-01 |

(Corrected 2026-10-01: the previous table totalled 26,620 and predated the DFF
and hotel imports. Companies: 14,711 on 2026-10-01.)

What the app itself has recorded, ever — measured 2026-10-01 (the 2026-09-28
column is what this file said before):

| | 2026-09-28 | 2026-10-01 | Note |
| --- | --- | --- | --- |
| notes | 334 | 3 by BDs (+334 by the HubSpot import) | The 334 were written by the migration (`actor_bd_id` null, one timestamp, 2026-09-26) — they were never BD-produced. BD notes: Macarena 2, Mariel 1 |
| emails sent from the CRM | 1 | 2 | the 2026-09-24 self-test, plus one by Cristian on 2026-10-01 18:47 (inferred to be the first #271 test send; unverified). A further 209 `email_sent` + 187 `reply_received` rows are **synced from Gmail** (`metadata.source = 'gmail_sync'`), not sent from the app |
| calls | 0 | 2 | both Mariel, 2026-10-01 |
| meetings | 0 | 2 | both Mariel, 2026-09-30 |
| tasks | 0 | 24 | Macarena 14, Mariel 8, Cristian 2 (the two Cristian tasks are 2026-09-29 tests, company-scoped); 22 on a person, 2 on a company |
| discards | 0 | 1 | Macarena, 2026-09-30 (`other`, with a note); a second discard was deleted by the owner on 2026-09-30 as a mistake (`owner_manual_fix` audit row) |
| company stage changes | not recorded | 10 | Macarena, 2026-10-01: 8 to `won`, 2 to `proposal_sent` |
| follow-up queue rows | — | 40 | Cristian 20, Macarena 20, none for Mariel; first row 2026-09-30 |

Contact statuses, live persons, measured 2026-10-01: `new` 18,953 ·
`contacted` 5,793 · `replied` 2,933 · `meeting` 2 · `discarded` 2. Almost all of
this is still **derived** from the HubSpot backfill, LinkedIn connection
counters and (since the sync) inbound Gmail replies; the 2 `meeting` and 2
`discarded` are the first statuses that come from a BD's action in the app.
(Corrected 2026-10-01: the earlier figures were `new` 17,882 · `contacted`
5,835 · `replied` 2,902 · `meeting` 0, and the claim "no status came from an
action taken in this app" is no longer true.) Why `contacted` fell by 42 and
`replied` rose by 31 since 2026-09-28 was not investigated: unverified.

That was the state on 2026-09-28. By 2026-10-01 most of what stood between the
team and a usable app has shipped — see **Shipped** below — and two of the
three BDs are already working in it. What's left is a short list of
in-progress items and manual owner actions (the 244 open duplicate pairs, plus
the owner decisions recorded below). Note what the activity above actually
shows: the volume is small, it is two people, and the `call` rows are not
obviously phone calls (the free-text notes on both read as a WhatsApp and an
email follow-up). **The first real week of use is still the test**, and it has
started.

## Shipped

- Shipped 2026-10-18/19: LinkedIn browser extension for Chrome and Edge
  (`extension/`, replaces the bookmarklet). On `linkedin.com/in/*` an in-page
  card says whether the person is already in the CRM
  (`GET /api/extension/linkedin-lookup`). "Agregar al CRM" prefills Nuevo
  contacto with name, job title, company and location read from that profile,
  only on click. The owner accepted LinkedIn's policy risk (manual use only).
  Distribution is "Load unpacked": the CRM serves the zip at
  `/api/extension/download` and a guide at `/account/extension`; releasing a
  new version means bumping `EXTENSION_VERSION` in
  `extension/build/manifest.ts`. Verified by the owner in Chrome on
  2026-10-19 (v1.0.2): download, lookup with the CRM session, and prefill on
  LinkedIn's new profile layout. Job title and company come from the current
  Experience role (the section is lazy-loaded; the reader scrolls to it and
  falls back to the headline). Edge labels in Spanish confirmed by the owner\n  the same day.
- Shipped 2026-10-18: (1) task legacy columns dropped (migration 0050 applied
  to production). (2) Phone E.164 normalization, normalize on write
  (`d6152619`..`f1b65eee`); the production backfill ran 2026-10-18 and changed
  3,092 values (audit_log `2db6e75c-b2ed-4a71-9bf1-23f724da0caa`; revert SQL in
  the `scripts/normalize-phones.ts` header). About 580 values were flagged and
  left untouched, by reason: possible_not_valid 188, no_country_code 112,
  invalid_number 71, needs_review 37, ar_area_code_unknown 26, text_or_extension
  21, multiple_numbers 13, ambiguous_country 13, too_few_digits 10,
  misplaced_plus 2. (3) LinkedIn exists-check: bookmarklet in /account
  "Herramientas", `/capture/linkedin` route, "Ya está en el CRM" notice and a
  prefilled `NewContactDialog` (`09982345`..`d3cab4a6`); the owner approved a
  size exception over the 400-line budget. (4) Click-to-call option (b):
  "Más detalles…" on the call outcome bar opens the call form prefilled, a
  dialled-number line, the follow-up task ticked only for connected calls, and
  the toast reads "Llamando con tu app de teléfono…" (`2688d373`..`632069f9`).
- Shipped 2026-10-17: bounce detection (hard bounces only, `5.1.x`, anti-spoof
  rules, no backfill; see **Bounce detection**). Lusha per BD shipped 2026-10-16
  (switch + usage report at `/admin/lusha`; see **Lusha per BD**).
- Shipped 2026-10-17: scheduled send (the Programados screen and the contact
  timeline cards), scheduled sends auto-cancelled on opt-out with a failure
  task, Lusha reveal storing both the work and the mobile phone, and new e2e
  specs (contact record, hiring three columns, Lusha per BD).
- Launch-readiness pass and every defect it found (#307–#312, 2026-10-02/03).
  The deliberate end-to-end pass Layer 1 asked for, run against a disposable
  local Postgres rather than production (see **Layer 1 → launch-readiness** for
  why, and for what that choice leaves untested). 14 defects found, 14 closed.
  The durable artefact is the harness itself: `tests/launch-readiness/` plus the
  `scratchDbGuard` that makes a production run impossible.
- A subjectless email, end to end (#313, #314, #316, #317, 2026-10-03). It began
  as a layout bug in a screenshot the owner had saved — subject and date
  overlapping in the admin conversation modal, because those rows omitted the
  avatar that `.thread-msg`'s two-column grid expects (#313). Fixing how a
  blank subject *renders* (#314, "(sin asunto)") exposed that a blank subject
  should not exist: nothing validated it, client or server. So a subject is now
  **required to send a new email** (#316) — replies stay exempt, because
  `replySubject()` derives theirs from the thread and may legitimately return
  `"Re:"`. That left Send disabled with no visible reason, which the owner
  resolved from a mockup (`openspec/changes/email-subject-required/mockups/`)
  in favour of a contextual warn hint (#317). The recipient address
  shape is now validated for every send (2026-10-18, `src/lib/gmail/recipient.ts`).
- Screenshot hygiene (#315, 2026-10-03). `screenshoots/` (95 files, 14 MB) and
  `bugs_ss/` were untracked and in no `.gitignore`. Now the directory contents
  are ignored except the 16 shots an openspec checklist actually cites (1.65 MB),
  so those citations resolve in a fresh clone. Note for anyone adding one: a
  bare `dir/` pattern makes inner negations dead, because git never descends
  into an excluded directory — the rule uses `screenshoots/*` plus `!…`.
- Follow-up cadence: the Seguimientos queue, capped at 10 contacts/day per BD
  (#215). Decisions in `openspec/decisions/2026-09-30-decision-brief.md`.
- Email coverage stage 1: 480 emails deduced from each domain's dominant
  pattern, labelled "Deducido" (#207; label at
  `src/lib/i18n/dictionaries/es.ts:786`). Production holds **478** rows with
  `email_source = 'pattern_inferred'` on 2026-10-01 — 2 fewer than the 480
  written; why (overwritten, merged away) was not investigated: unverified.
  Hunter stage 2 (paid lookup) stays deferred — a cost/deliverability call for
  the owner (unverified here: it is a decision, not something the code or data
  can confirm). Owner decision 2026-10-18: not now; stays TODO.
- Default pipeline stage: 14,255 companies backfilled — 2 `won` / 831
  `qualified` / 13,422 `prospect` (#205); new companies now default to
  `prospect`. (Corrected 2026-10-01: those are the backfill-time figures.
  Production now has 14,711 companies: `prospect` 13,871 · `qualified` 827 ·
  `won` 10 · `proposal_sent` 3, measured 2026-10-01 — the movement is BD
  stage changes plus 456 more companies, 454 of them from the DFF (365) and
  hotel (89) imports.)
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
  and verified. Re-checked 2026-10-01: **RLS is on for 36 of 36 `public`
  tables** (`pg_tables.rowsecurity`); the `@avalith.net` gate exists
  (`src/lib/auth/allowedEmail.ts`) and so does the current-password validator
  (`src/lib/auth/passwordPolicy.ts`). **Unverified: "sign-ups disabled" and
  `password_min_length = 12`** — both live in Supabase project config, and the
  Management API call to read them returned 401 (the `SUPABASE_ACCESS_TOKEN`
  in `.env.local` is expired or wrong). Re-check once the token is replaced.
- Custom SMTP via HostGator `notificaciones@avalith.net`; password reset
  verified end to end. DMARC `rua` fixed 2026-09-30 — now points to
  `notificaciones@avalith.net` (was the placeholder `email@yourdomain.com`).
  Re-checked 2026-10-01: `dig TXT _dmarc.avalith.net` returns
  `…;rua=mailto:notificaciones@avalith.net`. The SMTP configuration itself is
  **unverified** (same blocked Supabase config read); the `SMTP_*` variables
  exist in `.env.local`, and `src/lib/mailer/smtpMailer.ts` exists.
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
  `--revert` supported. Re-checked 2026-10-01: 1,001 `dff-2026` persons, all
  owned by Mariel; the `dff_2026_import` audit row lists 365 created
  companies; **989** of the 1,001 carry a mobile number and none carries a
  landline. The "998" would be those 989 plus the 9 matched existing persons —
  that arithmetic fits but the 9 were not individually checked: unverified.
- Smaller fixes: `pg_net` cron timeout raised to 60s to stop backfill runs
  timing out (#224); inbound Gmail matching now keys on sender only, so a
  contact merely cc'd on automated mail no longer flips to `replied` (#230,
  with `scripts/cleanup-misattributed-inbound.ts` to fix past cases);
  contacts board now fills the viewport with per-column scroll instead of a
  scrollbar far below the fold (#231); developer/sales_bd role groups hidden
  from `/contacts` by default, with an "Ocultos" chip to show them (#229;
  chip label at `src/lib/i18n/dictionaries/es.ts:1815`).

Shipped 2026-09-30 evening through 2026-10-01 (PRs #252–#292), each checked
against `main` at `eb83593` unless marked:

- **timestamptz migration complete — 71 of 71 columns** (slice 0 #221, slices
  1–6 #258–#260, #263, #264, #266; execution records #265, #267). Measured
  2026-10-01 in production: 71 `timestamp with time zone` columns and **0**
  `timestamp without time zone` in the `public` schema. See **timestamptz
  migration** below.
- **Merge phone loss: fixed and recovered.** Merges now carry
  `phone`/`mobile_phone` fill-blank (`MERGE_TRACKED_FIELDS`,
  `src/lib/identity/merge.ts:264`, phones at `:272-273`), and
  `tests/unit/mergePersonColumnCoverage.test.ts` forces a carry/do-not-carry
  decision for every `person` column (#272); `contact_type` is carried too
  (#275). `scripts/restore-merged-phones.ts` ran on 2026-10-01 13:28 UTC (run
  `a0d11319`): 35 fills across **34 persons**, 1 value skipped as invalid. See
  **Known defects → merges dropped phone numbers**.
- **Hotel contacts imported for Mariel** (#273): 147 persons
  (`source_key = hoteles-2026-10`, all owned by Mariel; 117 with an email per
  the PR, `email_source = 'hoteles-2026-10'` on 117 rows measured 2026-10-01)
  and a new nullable `person.contact_type` (`BUYER-CHAMPION` 104,
  `INFLUENCER` 43, measured 2026-10-01; migration 0034). UI for it (#274
  mockups, #278): a "Tipo de contacto" filter, an optional column after
  Estado, and an inline-editable record field; a `BUYER-CHAMPION` contact is
  never hidden by the role-group default (#284,
  `src/lib/contacts/roleVisibility.ts:67-80`).
- **`hasPhone` filter fixed — two wiring gaps** (#269, #270): `page.tsx` and
  `withAdHocFilterParams` both omitted `hasPhone` (and `emailVerified`), so the
  filter was silently never applied and its chip never rendered (#269); and
  unchecking a checkbox filter did not clear a value inherited from a saved
  view (#270). Both now go through one key list,
  `src/lib/contacts/adHocFilterParams.ts`.
- **Dialogs and disabled controls, app-wide:** dialog body scrolls so Save
  stays reachable (#276, `openspec/changes/dialog-scroll-fix/`); the task
  results list no longer clips on short viewports (#277); one disabled recipe
  for every button, and the opacity-based disabled style removed (#280,
  `openspec/changes/disabled-states/`); `.menu-item` buttons no longer render
  with the accent fill (#283). The measurements behind these are in the PR
  bodies and the static harnesses; the harnesses were not re-run in this
  pass.
- **Gmail send is `multipart/alternative`** (#271): `src/lib/gmail/rawMessage.ts`
  builds a text/plain part first and a text/html part last, with the text part
  derived from the HTML (`src/lib/gmail/outboundText.ts`). The same PR closed a
  pre-existing header-injection hole: `To` and `From` were interpolated raw, so a
  stored address containing CR/LF could add a `Bcc` to mail sent from a BD's own
  Gmail; `assertSafeHeaderValue` (`rawMessage.ts:54`) now rejects CR, LF and NUL
  and is called at the top of `sendGmailMessage` and again in `buildRawMessage`.
- **Per-BD HTML signature** (#286): `bd.signature_html` (migration 0035),
  sanitized at save and re-sanitized at send (`src/lib/signature/sanitize.ts`),
  edited on `/account` (`SignatureEditor.tsx`), appended by `composeEmailBody`
  (`src/lib/signature/compose.ts`, called at `contacts/actions.ts:367`). Measured
  2026-10-01: 1 of 4 `bd` rows has a signature (Cristian; audit row
  `bd_signature_update` 18:45 UTC). The timeline now shows the subject on sent
  emails (#289).
- **Gmail sync was silently dead for all three BDs on 2026-10-01, and is
  fixed** (#290), and its failures are now surfaced in the UI (#292). See
  **email-sync** below.
- **End-to-end suite revived** (#282, #285, #287, #288): a dedicated test
  account (`e2e-bot`, audit row `e2e_test_account_created`, a `ZZ E2E (no
  asignar)` row in `bd`), six stale specs ported to the Spanish UI plus one
  added; the PR reports 18 passed / 0 failed / 5 skipped, up from 6 / 6 / 10.
  **Not re-run in this pass** — it executes against the production database,
  which this pass must not write to.
- **Smaller:** scanner test fixtures written to `os.tmpdir` instead of `src`
  (#261); `pickEmailWinner` is one shared function between merge
  and duplicate tiering (#255); duplicates queue linked from the admin menu
  (#253); five more confirmed triangles collapsed (#254); a "Guías" nav
  section with a contact-status guide (#257); the drizzle journal's
  future-dating kept on purpose and its test now says how to fix a failure
  (#279); hotel data-quality analysis and a read-only report script (#281);
  `task.lead_id`/`task.contact_id` recommendation (#291).

Not individually re-checked in this pass (merged PRs whose behaviour was not
re-exercised; treat as "merged", not "verified working"): the Shipped entries
dated 2026-09-30 above other than the ones carrying a "Re-checked 2026-10-01"
note, and PR #293, which is **open, not merged** (reply to a synced email
thread from the contact record) and so is not listed as shipped.

## Layer 1 — before the team comes in

These are the things that make the first week survivable. (Note 2026-10-01:
the team is already in — Mariel and Macarena have been using the app since
2026-09-30 — so read this layer as "what should already have been true", and
the items below as gaps being felt now, not hypothetical ones.)

### launch-readiness
Calls, meetings, tasks and discards are complete and reachable, and **have now
run in production** — but only a little, by two people. Measured 2026-10-01:
2 calls and 2 meetings (Mariel), 24 tasks (22 by BDs), 1 discard (Macarena).
(Corrected 2026-10-01: this entry used to say they had "never run once outside
a test"; the 2026-09-28 inventory was the last time that was true.)

**Done 2026-10-02/03 — the pass this entry existed to force has been run, and
everything it found is fixed.** PR #307 (`b31a146`) walked each feature
deliberately and wrote down what broke:
`openspec/changes/launch-readiness-pass/README.md` records **14 defects**
(F1–F14), each reproduced by a spec in `tests/launch-readiness/`. All 14 are
closed: **#308** F1–F2 (the two that lost data), **#309** F3/F10/F11/F13,
**#310** F4/F7/F8/F9, **#311** F5/F12/F14, **#312** F6. F6 was not a code
question but an owner decision, taken 2026-10-03: a `wrong_number` call still
counts as `contacted`, but the follow-up queue skips that contact
(`src/lib/followUp/candidateQuery.ts`; `src/lib/status/deriveStatus.ts` is
unchanged). No `test.fail` wrapper is left in `tests/launch-readiness/`
(measured 2026-10-03).

**One correction to this entry's own premise:** it asked for a pass "against
production data". It was deliberately NOT run that way. The pass **writes**
(calls, meetings, tasks, discards) and the app has no delete path, so anything
written to production would stay there forever; it ran against a disposable
local Postgres (`bd_contact_intel_e2e`) behind
`tests/launch-readiness/scratchDbGuard.ts`, which refuses any non-local host or
any database name not ending in `_e2e`. The cost of that choice is recorded in
the pass README's own limitations: production scale and speed (about 27,700
persons, 14,700 companies) were not exercised, and `next dev` is not a
production build.

**Still unverified:** the Playwright suite has not been re-run since the fixes
landed — it needs `.env.e2e.local` (the e2e bot's Supabase credentials), which
was absent on the machine that made these fixes. F6's fix was instead verified
by executing the real query against the scratch Postgres with six fixture cases
inside a rolled-back transaction (2026-10-03); the other fixes rest on unit
tests, typecheck and code review. Nothing in #308–#312 was exercised in the
running app.

This entry was never QA theatre — `task.lead_id` has schema
and an index (`src/db/schema.ts:1171`, `:1196`) and is selected on every task
read (`src/lib/tasks/queries.ts:40`), but has **no write path anywhere and no
join or rendering**: `createTaskAction` declares `leadId?: string`
(`src/app/(app)/tasks/actions.ts:26`) but none of its three callers
(`NewTaskButton.tsx:127`, `contacts/actions.ts:196`, `companies/actions.ts:166`)
passes it; bulk create never touches it; `TaskEditInput`/`resolveTaskSubject`
don't have the field; the task list queries left-join only `bd`, `person` and
`company` (`queries.ts:64-66`, `:351-353`); no `.tsx` file references `leadId`.
Measured 2026-10-01: `lead_id` is set on **0 of 24** `task` rows. (Corrected
2026-10-01: an earlier version of this entry said the column had "joins and
rendering" and named `NewTaskButton.tsx` as the only caller; neither was true.)
It is exactly the class of gap that only surfaces when a
human tries to use the thing. See **Known defects → task.lead_id and
task.contact_id**. (Correction: `task.description` is not part of
this gap — it has three live write paths: per-record create
(`NewTaskButton.tsx` → `createTaskAction` → `createTask`), bulk create from the
contacts list (`BulkActionsBar.tsx` → `bulkCreateTaskAction` →
`buildBulkTaskRows` → `bulkCreateTasks`), and edit (`EditTaskDialog.tsx` →
`updateTaskAction` → `updateTaskWithActivity`, commit `fa46a0e`). The earlier
note here predates that commit.)

### bd-password-reset (manual) — shipped and run once
`scripts/reset-bd-password.ts` (PR #179) sets a random temporary password
through the Supabase admin API, writes `audit_log`, and prints the password
once. Dry run is the default; `--execute --actor=<bd id>` needs
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. (Corrected 2026-10-01: this entry
said the key "is not there yet" and that the admin call and audit insert "have
never run". The key is present in `.env.local` (name checked 2026-10-01, value
not read), and production has an `audit_log` row `bd_password_reset` at
2026-09-29 12:53 UTC whose target is the owner's own account — the smoke test
this entry asked for was done.) The row's note records that it ran before the
custom SMTP existed; whether a reset was re-run end to end after the SMTP
switch is unverified. Remaining owner action: none known for this script.

### gmail-connection
Every BD needs to connect their own Gmail account before they can send
anything. **All three BDs are connected** — measured 2026-10-01:
`email_account.status = 'connected'` for Cristian (connected 2026-09-24),
Macarena (2026-09-28) and Mariel (2026-10-01 13:02 UTC), each with
`gmail.readonly` and `gmail.send` granted (needed for email sync, below).
(Corrected 2026-10-01: this entry said only Cristian and Macarena had
reconnected and "the rest of the team still needs to walk the flow at all".)
Also worth knowing: connected is not the same as syncing — see **email-sync**.

## Layer 2 — closing the loop

### email-sync
Two-way email logging on the Contact timeline, HubSpot-style. Shipped: backend
— readonly scope, message store, sync route, 90-day first-sync backfill
(#217); UI — threads, connection states, never-log, reconnect banner (#222);
never-log now suppresses the whole message rather than per-address (#218).
Runs via Supabase `pg_cron` every 15 minutes (`net.http_get`,
`scripts/gmail-sync-cron.sql`). Re-checked 2026-10-01: `cron.job`
`gmail-sync-every-15-min` is active with schedule `*/15 * * * *`, its command
carries `timeout_milliseconds := 60000` (#224), and 12 runs succeeded in the 3
hours before 01:45 UTC. (`vercel.json` also schedules `/api/gmail/sync` once a
day at 12:00 UTC as a second trigger; why both exist was not investigated:
unverified.) This is what lets `person.status` reach `replied` from an inbound
signal — previously nothing captured inbound mail. Measured 2026-10-01:
322 rows in `email_message`; 209 `email_sent` and 187 `reply_received`
activities carry `metadata.source = 'gmail_sync'`.

**The sync was silently dead for all three BDs on 2026-10-01 and nobody could
see it (fixed #290, surfaced #292).** `getMessage` threw on any non-OK status,
and the fetch loops in `syncAccount.ts`/`backfillAccount.ts` had no `try`, so
**one message that no longer existed (a Gmail 404) aborted the whole run for
every BD, every tick** — for 6+ hours (per the PR), while `last_synced_at`
advanced every 15 minutes (it was bumped on failures too), the account stayed
`connected`, and `email_account.sync_error` held the cause but was never
rendered. `email_message` stayed at 308 rows from 12:57 UTC, and a test mail
sent at 18:47 plus its reply were both missed. The fix returns `null` on a 404
(any other non-OK still throws — a 401 needs reauth, a 429 needs backoff) and
the cursor now counts attempted ids instead of successes, so a skipped 404
cannot pin the cursor forever. #292 made `last_synced_at` mean the last
**successful** sync, added `src/lib/gmail/syncHealth.ts` (ok / failing / stale /
inactive; stale = 60 minutes, four missed ticks), a plain-language alert on
`/account/email`, and a non-dismissible shell banner for failing or stale. Raw
error text is shown to admins only. Verified 2026-10-01 in production: all three
accounts have `sync_error` null and `last_synced_at` within the last 15
minutes. Lessons worth keeping: a green `cron.job_run_details.status` only
means the HTTP call was made, not that the sync succeeded; and a timestamp that
advances on failure is worse than none.

Still open:
- ~~**No fleet view for the owner.**~~ **Shipped 2026-10-18** (`49fa5b75`):
  `/admin/gmail` ("Estado de Gmail") lists every BD's connection, sync health,
  last email sent or received, and hard/soft bounces, with per-column hover
  tooltips (`src/components/Tooltip.tsx`). Admins can send an audited
  connection reminder (`src/lib/gmail/manualReminder.ts`), and the sidebar
  shows how many BDs need attention (`src/lib/gmail/fleetAttention.ts`).
  Migration 0052 (`email_message (bd_id, sent_at DESC)`) applied to prod
  2026-10-18.
- Mariel's Gmail connection: **resolved** — `connected` since 2026-10-01 13:02
  UTC with both scopes. (Corrected 2026-10-01: this entry said she could not
  connect, rejected with `Error 403: org_internal` (2026-09-30), because the
  OAuth app `crm-evolution` has an **Internal** consent screen and her account
  was not in the Cloud project's Workspace organization. How it was resolved —
  moved into the organization, or a different sign-in — was not recorded:
  unverified.) The standing warning stays true as design guidance, not as
  an open item: do NOT switch the consent screen to External — `gmail.readonly`
  is a restricted scope, so publishing needs Google's security assessment, and
  External+Testing expires refresh tokens every 7 days. (Also still true: an
  earlier note claimed her mailbox was not Gmail; `avalith.net`'s MX is
  `aspmx.l.google.com` — re-checked 2026-10-01 with `dig`.)
- Admins now reach another BD's conversation through the audited modal (#232,
  #237); the standalone page was removed. (`getConversationForAdmin` is in
  `src/lib/activity/getConversationForAdmin.ts`; `ConversationDialog` in
  `src/components/ConversationDialog.tsx` — both exist on `main`.)

### email-outbound — owner request 2026-10-01
Owner asked for three things: send mail from the CRM, a per-BD HTML signature
on outgoing mail, and open/engagement notifications "like HubSpot". All three
turned out to share one root blocker, and the first one is already built.
**Status 2026-10-01: the blocker is gone and two of the three are shipped**
(HTML send #271, per-BD signature #286); tracking and notifications are not
built. (Threading shipped later: `d719cd11`, `0506459b`, checked 2026-10-18.)

**What already exists.** `src/lib/gmail/send.ts#sendGmailMessage({ bdId, to,
subject, personId, … })` — now taking either `body` (plain text) or `bodyHtml`
— sends through the BD's own connected Gmail account and is wired to the record
page's "Correo" action (`sendContactEmailAction`,
`src/app/(app)/contacts/actions.ts:356`, the send at `:367`). `gmail.send` has
been in the requested OAuth scope from the start — `gmail.readonly` was the
later addition, for sync. It logs an activity via `createActivityAction`.

**The blocker all three shared — resolved (#271).** (Corrected 2026-10-01: this
paragraph said `buildRawMessage` (`send.ts:20-32`) hardcodes
`Content-Type: text/plain`. It no longer does, and no longer lives in
`send.ts`: `buildRawMessage` is in `src/lib/gmail/rawMessage.ts` and emits
`multipart/alternative` — text/plain first, text/html last, boundary verified
absent from both parts — when HTML is supplied; text-only still yields a single
`text/plain` part.)

Still gaps in the send path, re-checked 2026-10-01 (`rg` finds no
`In-Reply-To`, `References`, `Cc`, `Bcc` or attachment handling under
`src/lib/gmail`):
- ~~No `In-Reply-To`/`References` headers~~ — fixed (checked 2026-10-18):
  `d719cd11` sends real replies with `In-Reply-To`, `References` and `threadId`
  (`src/lib/gmail/rawMessage.ts:143-149`, `send.ts:41`), and `0506459b` replies
  to a synced thread from the contact record (`sendThreadReplyAction`, planned by
  `planThreadReply`, `contacts/actions.ts:409-427`). A NEW email still starts a
  new thread, as it should.
- Single `to` only — no CC, no BCC, no attachments. **Owner 2026-10-19: build
  attachments and multiple recipients, only when all recipients belong to the
  same company** (change `email-attachments-recipients`). ~~A multi-recipient `To`
  string passes the guard~~ — fixed 2026-10-18: `buildRawMessage` and
  `assertSafeSendInput` call `assertRecipients`, so a new email, a scheduled
  send and sequences reject a list or a malformed address (`invalid_recipient`;
  Spanish copy via `multiple_recipients` / `invalid_email`). A thread reply
  (`sendThreadReplyAction`, a scheduled reply) opts in with
  `allowRecipientList` and may go to up to 20 stored addresses, each one
  validated; one bad address rejects the whole send.
- ~~Long subjects are one RFC 2047 encoded-word~~ — fixed 2026-10-18
  (`subjectEncoding.ts`): folded into words of at most 75 chars, cut on
  code-point boundaries.

Open and done:
- **HTML send — done (#271).** `multipart/alternative`, with the plain-text
  part generated from the HTML (`src/lib/gmail/outboundText.ts`) rather than
  hand-written twice. `tests/unit/gmailRawMessage.test.ts` decodes the generated
  message back. **Not smoke-tested against a real mailbox by the author**; the
  one CRM-sent mail in production (2026-10-01 18:47 UTC, Cristian) is the
  closest thing to that, and whether it rendered correctly in the recipient's
  client was not verified here.
- **Per-BD signature — done (#286).** `bd.signature_html` exists
  (`src/db/schema.ts:28`, migration 0035), is sanitized at save and re-sanitized
  at send, has an editor on `/account` (`SignatureEditor.tsx`), and is appended
  by default through `composeEmailBody`. (Corrected 2026-10-01: this bullet said
  "there is no column for it today — `bd` is only (`id`, `name`, `email`,
  `role`)".) Only 1 of 4 `bd` rows has one set (measured 2026-10-01): Macarena
  and Mariel have none, so their mail still goes out as single-part plain text.
- **Threading — done** (`d719cd11`, `0506459b`; checked 2026-10-18). The reply
  headers come from the synced `email_message` row. Not smoke-tested against a
  real mailbox by this pass: unverified.
- **Open and click tracking — not built** (re-checked 2026-10-01: `src/app/api`
  holds only `gmail`, `hiring`, `leads`, `signals` and `tasks`; there is no
  public pixel endpoint and no link rewriting). Needs the HTML part (now
  available) plus a public,
  unauthenticated pixel endpoint and link rewriting. Be honest about the
  ceiling before building it: Gmail proxies remote images through
  `googleusercontent.com`, so it PREFETCHES them — an "open" can fire without
  a human reading anything, and a recipient who blocks images never fires one.
  HubSpot lives with the same imprecision. Decide up front whether an
  approximate signal is worth a tracking pixel on mail sent over a BD's own
  address, and what it does to deliverability. Owner decision 2026-10-18: deferred; stays TODO.
- **Notifications — not specified, not built.** Where does an open surface —
  the contact timeline, a badge, the daily digest that already exists? Blocked
  on the tracking decision above. Owner decision 2026-10-18: deferred together with tracking; stays TODO.

## Layer 3 — the pipeline nobody is using yet

(Note 2026-10-01: no longer "nobody". Macarena changed 10 company pipeline
stages on 2026-10-01 — 8 to `won`, 2 to `proposal_sent` — and `won` went from 2
to 10 companies. Small, one person, one morning; the owner report below was
built for this and now has something to show.)

### owner-reporting — shipped
No longer a mockup: built and merged (#234, BD-filter/drilldown fix #239) —
see **Shipped** above. Discard reasons were already a fixed, validated code
list before this shipped (`wrong_profile`, `not_interested`, `other_vendor`,
`left_company`, `bad_data`, `other`, a note required for `other`), stored in
`activity.metadata` JSONB — queryable but not independently indexed (codes
re-checked in `src/lib/contacts/discard.ts:13-17` and
`src/lib/reports/discardReasons.ts`). (Corrected 2026-10-01: this entry said
production has no discards recorded. Measured 2026-10-01: **1** `discarded`
activity — Macarena, 2026-09-30, reason `other` with a note — and 2 persons
with `status = 'discarded'`; the report has a sample of one, so its
discard-reason breakdown is still not informative. Why 2 persons but 1
activity was not investigated: unverified.)

## Layer 4 — product depth

### admin-email-conversation-access — shipped
No longer a mockup: `getConversationForAdmin` now has a real UI path — the
audited confirm-then-view flow (#232) and the shared `ConversationDialog`
that replaced the standalone page (#237); see **Shipped** above. It serves
synced Gmail threads as well as LinkedIn history, and every view is logged to
`audit_log` before the read.

### auth-security — verified
Checked on the Supabase project 2026-10-16/17: `disable_signup = true`, minimum
password length 12, and the invite template uses `token_hash`. Still not
checked: `mailer_autoconfirm` (harmless while sign-ups are disabled).

### timestamptz migration — complete
(Corrected 2026-10-01: this entry said "All timestamp columns are `timestamp
without time zone`" and that slices 1–6 were "still pending on `main`", with
slice 1 only "in-flight". All six slices are merged and applied.) Plan:
`openspec/decisions/2026-09-30-timestamptz-migration-plan.md`; per-slice
runbooks and execution records are in `openspec/decisions/`
(`2026-09-30-timestamptz-slice-1/2/3-runbook.md`,
`2026-10-01-timestamptz-slice-4/5/6-runbook.md`). Slice 0 (prep) #221;
slice 1 #258, 2 #259, 3 #260, 4 #263, 5 #264, 6 #266. **Measured in production
2026-10-01: 71 columns of type `timestamp with time zone` and 0 of type
`timestamp without time zone` in the `public` schema — 71 of 71.** The
`drizzle.__drizzle_migrations` table holds 36 rows, matching the 36 journal
entries, and its latest `created_at` equals the journal's last `when`. The
"run local checks with `TZ=UTC`" advice is obsolete: `npm run test:unit`
(2,317 tests) passes unchanged under `TZ=UTC`, `TZ=America/Argentina/Buenos_Aires`
and `TZ=Asia/Tokyo` (run 2026-10-01). Standing consequence for anyone adding a
migration: see **Known defects → drizzle journal is future-dated**.

### click-to-call — research first
Owner request (2026-09-30): evaluate whether a BD can place a call to a
contact from inside the platform.

Why it matters now: the Digital Finance Forum import (#244) added **998 phone
numbers** (989 mobiles on the 1,001 created persons, measured 2026-10-01; see
**Shipped** for the arithmetic) and the hotel import (#273) added 147 mobiles
and 61 landlines (measured 2026-10-01); `person.mobile_phone`/`phone` are
already surfaced, editable and exported. Calling is suddenly the channel with
the most raw material — and `activity` has had a `call` type with an
`occurredAt` metadata path since the beginning, yet production holds **2
logged calls** (measured 2026-10-01, both Mariel, 2026-10-01; that figure
predates the one-tap bar `call-logging-one-tap`, which was already shipped).
(Corrected
2026-10-01: this said "zero logged calls". Both rows' free-text notes read as a
WhatsApp and an email follow-up, not a phone call — which, if representative of
two rows, suggests the call form is being used as a generic "I touched this
person" log.) The research brief already exists:
`openspec/decisions/2026-09-30-click-to-call-research.md`; its recommendation
is to ship only the `tel:`-to-call-form bridge (about a day) and not buy a
dialer. Whether the owner accepted it is not recorded: unverified. Note the
brief's own "currently: zero, ever" is stale for the same reason as above.

What already works, and costs nothing:
- `toTelHref` (`src/lib/phone.ts:45`) already renders phone rows as `tel:` links
  (used by `contacts/[id]/PropertyList.tsx` and `contacts/page.tsx`), so a
  click already dials from a mobile or from any desktop softphone. Before
  buying anything, confirm whether that alone covers the need. (The brief
  notes it did not confirm whether the record page renders the link as a
  clickable `<a>`; this pass did not either: unverified.)

What "call from the platform" usually means, in increasing cost:
1. `tel:` links (today) — free, no infra, no automatic logging.
2. Click-to-call through a provider that rings the BD's own phone first and
   then the contact — moderate cost, no browser audio, works from a laptop.
3. A WebRTC softphone in the browser (Twilio Voice, Vonage and similar) — real
   per-minute cost, needs a purchased number, and raises call-recording and
   consent questions under Argentine law.

The valuable part is probably NOT the dialing — it is **automatic call logging**:
a `call` activity written with duration and outcome without the BD having to
remember, which is exactly the step that is failing today (2 calls logged in
total on 2026-10-01).
A brief should weigh "make logging effortless" against "make dialing possible".

Blocking dependency: the imported numbers are stored raw, with no country code.
Measured 2026-10-01: 978 of the 989 DFF mobiles are digits only (11 start with
`+`); across all live persons 1,139 of 1,426 mobiles are digits only and 246
start with `+`. (Corrected 2026-10-01: this said "see the phone decision in
this file's Shipped section" — there is no such decision in this file; it is in
`openspec/decisions/2026-09-30-click-to-call-research.md`. And "mostly 10
digits" was not measured: only digits-only vs `+`-prefixed was.) Any provider
needs E.164 (`+54 9 ...`), so the normalization question the owner deferred has
to be answered first — and it cannot be answered by digits alone, since a
10-digit Argentine number does not say whether it is a mobile or a landline.
The hotel import adds the opposite problem: numbers that arrive with a dial
code which disagrees with the contact's country — see **Known defects →
hotel-phone-dial-codes**.
Owner decision 2026-10-18: normalization to E.164 is APPROVED; dry-run plan
measured 2026-10-18 (~2,074 values strippable to +digits without inference, ~890
DFF 10-digit mobiles need an Argentina assumption pending owner OK).
Implementation pending that OK.
**Done 2026-10-18:** normalize on write (`d6152619`..`f1b65eee`) and the
production backfill changed 3,092 values (audit_log
`2db6e75c-b2ed-4a71-9bf1-23f724da0caa`; revert SQL in the
`scripts/normalize-phones.ts` header). About 580 flagged values were left
untouched; the by-reason counts are in **Shipped**.
Owner decision 2026-10-18: option (b) — keep the one-tap bar and add "Más
detalles…" with the full form; no paid dialer. Shipped 2026-10-18.

Output (done): a decision brief in `openspec/decisions/` covering the three
options with real pricing, the recording/consent constraint, what changes in
the data model (if anything), and an explicit recommendation — including the
honest option of "the `tel:` link is enough; spend the effort on logging
instead". The brief's pricing was not re-verified in this pass: unverified.

### linkedin-chrome-extension — ON HOLD (owner decision 2026-09-30)

**Held, not rejected.** The workflow is worth having; there is no way to build
it that satisfies all three of the owner's constraints at once. Recorded in
full so it is not re-litigated from scratch.

What was asked: when a BD connects with someone new on LinkedIn, a modal
offers to push that person into this CRM with name, company and role already
filled — the Apollo-style flow.

What the terms actually say (fetched from linkedin.com/legal/user-agreement,
2026-09-30; **not re-fetched on 2026-10-01 — everything below about LinkedIn's
terms, the Proxycurl shutdown and the lawsuit, and the Apollo / People Data
Labs pricing is external and unverified in this pass**):

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
   actually costs money — 98 duplicate pairs were merged on 2026-09-30 and
   244 remain (re-measured 2026-10-01; of the 98, 74 were by the bulk CLI, 16 by
   the triangle script and, by subtraction, 8 by hand in `/admin/duplicates` —
   see **duplicates queue**), and an uncontrolled capture path is exactly how
   that queue refills. Ship this whatever happens to the rest. (Code claim
   re-checked 2026-10-01: `NewContactDialog` opens prefilled today only for a
   company, via `initialCompany`, `NewContactDialog.tsx:54-64`; prefilling from
   a LinkedIn URL does not exist yet.)

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
Owner decision 2026-10-18: build the free half (URL-only exists check). Shipped
2026-10-18 as a bookmarklet. The paid enrichment half stays declined. Whether the
bookmarklet works under linkedin.com's CSP is unverified until the owner tests it.

Superseded: `openspec/decisions/2026-09-30-linkedin-extension-research.md`
(no-go) and `2026-09-30-linkedin-extension-brief.md` (conditional go). Both
kept; this entry records where the decision actually landed and why.

### free-ai-for-simple-tasks — research first
Owner request (2026-09-30): use other AI models for simple, low-stakes
("dummy") tasks, preferring **free** options, possibly choosing a different
model per task. Nothing is decided yet — the owner has not recorded a
decision on the brief (unverified).

- Today every AI call goes through the Vercel AI Gateway (`ai` +
  `@ai-sdk/gateway`, both in `package.json`): outreach message generation
  (`src/lib/outreach/generateMessage.ts:30`, `anthropic/claude-sonnet-5`) and
  the startup classifier (`src/lib/hiring/startupClassification.ts:12`,
  `anthropic/claude-haiku-4.5`) — both lines re-checked on `main` 2026-10-01.
  The gateway already routes to many providers by model string, so switching
  a task to another model is usually a one-line change.
- Research questions:
  - which tasks count as simple (classification, name or title
    normalization, short summaries, tagging)
  - which models are free or near-free for each, and at what quality
  - rate limits and data-retention terms (contact data must not be used for
    training)
  - whether the gateway's own free tier or credits already cover it
- Output (done): `openspec/decisions/2026-09-30-free-ai-brief.md`. Its
  finding is that there are exactly two model call sites and its
  recommendation for both is to keep them; the free-tier terms it cites were
  not re-verified: unverified.
- Owner decision 2026-10-18: keep both call sites as they are (Sonnet for
  outreach, Haiku for startup classification). Closed.

### Bounce detection — shipped 2026-10-17
Merged to `main` 2026-10-17 (`318282aa`..`37b28107`, plus the record/list/timeline
display in `60083224`). Gmail sync reads delivery notifications
(`src/lib/gmail/parseBounce.ts`, `bounceQueries.ts`), treats only bad-address
codes (`5.1.x`) and explicit unknown-user text as a HARD bounce, applies the
anti-spoof rules (a system sender, our own Message-ID referenced, a null
Return-Path tied to the sender host), and stops sending to the dead address.
The bounced email shows on the contact record, in the list and in the timeline
(`BounceTimelineCard.tsx`). Still true by design, so still open as trade-offs:
an Exchange/M365 `550 5.4.1` stays a soft bounce; NDRs from
`MicrosoftExchange…@tenant` senders are ignored; there is no backfill of
historical bounces.

### Lusha phone reveal: measured 2026-10-15, three findings from the real shape

Gate 0.7 is CLOSED. The first real phone reveal (Pablo Martín Charchaflie /
Despegar, by Mariel Meza) billed search 1 + phone 5 = **6 credits**, both
reserved and charged equal, and the value landed in `person.mobile_phone` —
correct, because the entry is typed `mobile`. `pickPhone` read it right: the key
really is `number`, which until now was an assumption.

The shape, which had never been seen:

```json
{"phones":[{"type":"mobile","number":"+54 9 11 3026-1031","doNotCall":false,
            "dataSource":"Lusha","updateDate":"2026-10-15","countryIso2":"AR"}]}
```

1. **`doNotCall` exists and nothing reads it.** A number on a national
   do-not-call registry; Lusha's docs describe the feature as HIDING such
   numbers and warn that calling one may bring significant fines. Two limits
   make `false` much weaker than it looks: the documented registries are **UK
   (TPS/CTPS) and the US only**, and the hiding feature is **Scale-plan only**
   while this account is on free (measured 2026-10-14). So on an Argentine
   number `false` means "not on a list Lusha checks", probably "not checked at
   all" — NOT "safe to call". Argentina has its own Ley 26.951: whoever offers
   goods or services by phone may not call anyone registered and **must consult
   the list every 30 days**, and on a complaint the burden of proof is on the
   caller. A vendor flag covering UK/US is not evidence of having consulted the
   Argentine registry. Reading the flag is still worth doing — it is free and
   real for US/UK numbers, which is where the Sequences motion points — but it
   must not create false confidence, and storing it unqualified would be worse
   than not storing it. This belongs with **gate 0.4** (counsel sign-off) in
   `openspec/changes/outreach-sequences/tasks.md`. Not legal advice; the current
   fine amounts route through Ley 25.326 and were NOT verified: unverified.
2. **Phones carry no `confidence` field at all**, so the grade tiebreaker in
   `choose()` is inert for phones — not because of the letter-grade bug fixed in
   77e5707, but because the field does not exist in this response.
3. ~~Latent defect: the ranking preferred `type: "work"` over `mobile`.~~
   Resolved 2026-10-17: one phones reveal now stores both the work and the
   mobile number, and the type is compared case-insensitively (`da42b3a8`,
   `b9d4b84d`).

`countryIso2` was discarded; **fixed 2026-10-18**: it is read from the raw payload (already stored, no column or migration), carried on the pick, and passed to `normalizePhoneForWrite` as the country of that number. (Re-checked
2026-10-18: `rg countryIso2 src` finds nothing, so it is still not stored. The
`doNotCall` flag IS now read: `src/lib/lusha/parse.ts:247`, `doNotCallDb.ts`,
`doNotCallWarning.ts`, so finding 1's "nothing reads it" is out of date.)
Owner decision 2026-10-18: keep the current behaviour for `doNotCall` (warning only,
no block).

### Lusha per BD: enable/disable from admin, and a consumption report — shipped 2026-10-16, cap still global

**Status 2026-10-18 (checked in code): the switch and the consumption report
are both shipped** (merge `2d517df6`, "lusha-per-bd"). `bd.lusha_enabled`
(migration `0047`; existing BDs kept access, new BDs default to false) is
flipped from `/admin/lusha` (`LushaSwitch.tsx`, `setLushaEnabled` in
`src/lib/lusha/adminDb.ts`, written together with an `audit_log` row). The same
screen holds the per-BD usage report by week/month/quarter
(`src/lib/lusha/usageReport.ts`). **Still open:** the daily cap is still the
global module constant (`src/lib/lusha/cap.ts`); a per-BD cap was never decided.
Owner decision 2026-10-18: the daily cap stays global.
The original brief follows.

Owner decision, 2026-10-15: **a new BD starts DISABLED.** Access to a paid
endpoint is granted deliberately, never inherited by existing by default.
Mariel is expected to be the heaviest user.

Most of the data already exists. Every `lusha_reveal` row carries
`actor_bd_id` and both `credits_reserved` and `credits_charged`
(`drizzle/0043_lusha_reveal.sql`), so a per-BD consumption report is a query
over rows we already write, not new instrumentation. What is missing is the
per-BD switch itself and the admin screen to flip it.

Two things to settle when this is picked up:
- Where the switch lives. The daily cap is a module constant today
  (`src/lib/lusha/cap.ts`, default 12, changing it needs a redeploy), so a
  per-BD flag kept the same way would need a deploy per BD — almost certainly
  wrong. A column on `bd`, or a small settings table, is the obvious
  alternative; unverified which fits the existing admin screens better.
- Whether the cap is global (as today) or per BD too. The owner has not been
  asked. Note that a per-BD cap and a global cap answer different questions:
  one stops a person, the other stops the invoice.

### Admins read another BD's conversation inline, with no click and no audit row

Owner ask, 2026-10-15: an admin should see the conversation content in a
contact's timeline "directo, sin que quede en auditoria ni tampoco presionar un
boton para ver, debe ser visibile de inicio". Today that timeline entry renders
a locked card instead (`lockedConversationText`,
`src/app/(app)/contacts/[id]/Timeline.tsx:294`, from
`timelineLockedThreadBelongsTo` / `timelineLockedThreadPrivacyPrefix` /
`timelineLockedThreadPrivacySuffix`, `src/lib/i18n/dictionaries/es.ts:857-858`)
with a "Ver conversación" link (`es.ts:761`).

**The click and the audit row are coupled, which is why both asks arrive
together.** An admin read goes through `getConversationForAdmin`
(`src/lib/activity/getConversationForAdmin.ts:96`), which writes an `audit_log`
row when `shouldAuditConversationView(actorBdId, targetBdId)` is true
(`:110`; pure rule at `src/lib/activity/conversationAudit.ts:8`). One
deliberate click is one row. Render the content inline and that write becomes
one row per contact-page view, which would bury `/admin/audit-log` in noise —
so "inline" and "no audit" are one decision, not two.

What this does and does not change:
- It breaks no promise made to the BD. The existing copy already says the
  content is private "para {BD} (y los administradores)", so admin visibility
  is already disclosed; the ask only removes the click.
- It DOES remove the only record of which admin read which BD's private
  conversation. `view_conversation` is a documented audit action
  (`src/db/schema.ts:990`) with a screen built on it (`/admin/audit-log`, nav
  entry at `src/app/contacts/Sidebar.tsx:137`), and the requirement is recorded
  as the admin-access-audit spec's "Admins can always read any BD's
  conversations" (`src/lib/contacts/connectionTimelineEntries.ts:52`).
- Middle path worth a decision rather than assuming all-or-nothing: keep the
  content inline and keep accountability, but AGGREGATE it — one row per
  (admin, contact, day) instead of one per render. Noise gone, record kept.

Open before implementing:
- Inline content means loading message bodies for every thread on the page
  instead of on demand. How heavy that is was NOT measured: unverified
  (`email_message.body_text` is free text and `body_truncated` exists, so some
  rows are already large enough to have been cut).
- Whether the locked card should disappear entirely for admins, or stay as a
  header over the now-visible content so it is still obvious whose thread it
  is.

**Shipped 2026-10-16 (branch `admin-inline-conversation`).** Both open
questions above are settled:
- Cost: the inline bodies are ONE statement
  (`getAdminInlineConversations`, a UNION ALL of synced mail and LinkedIn
  messages), admin-only, capped at 100 rows and 4,000 characters per body
  (`left(...)` in SQL, so a 256 KB body never leaves Postgres): worst case
  about 400 KB. Past the row cap the newest rows win and the timeline says so.
- The locked card disappears for an admin; another BD's synced thread renders
  open under a "conversation of {BD}" line, and the single-entry cards already
  name their BD in the header.
No audit row is written; `getConversationForAdmin`, the confirm dialog and the
`?conversation=` auto-open were deleted. Past `view_conversation` rows and
`/admin/audit-log` stay; its "Abrir" link now lands on the record's timeline.
Spec: `openspec/changes/crm-hubspot-ux/specs/admin-access-audit/spec.md`.
The aggregated middle path (one row per admin/contact/day) was not taken.
Follow-ups closed the same day: synced mail with no `activity` row (the send path
stores one `email_message` for every matched person but writes its activity for
one) is flagged `orphan` in the same statement and listed with the mail entries;
the company timeline applies the same admin rule (it never shows bodies, only
what the owner would see).

## Known defects

### contact-names
- 143 of 191 stuffed full-names were split 2026-09-29
  (`scripts/backfill-split-stuffed-names.ts`, PR #186, audit row `df7a98fe`,
  revertible). The rest are genuinely ambiguous ("Gonzalo Castro Peña": one
  given name and two surnames, or the reverse), start with a particle, or are
  junk. **Shipped 2026-09-30 (#226):** a first-token/compound-given-name rule
  (gated behind the original classifier) split 48 of the remainder in
  production; audit row `person_first_token_split_backfill`, revertible;
  re-run finds 0 left under this rule. Re-checked 2026-10-01: the audit rows
  exist — `df7a98fe-…` (`person_stuffed_name_split_backfill`, 143 fills applied
  of 143 planned) and `104a45af-…` (`person_first_token_split_backfill`, 48 of
  48). **Unverified:** "143 of 191" plus "48 of the remainder" does not obviously
  reconcile — 191 − 143 is exactly 48, yet the remainder is described as
  ambiguous, particle-led or junk, which a first-token rule would not be
  expected to split in full. The 191 figure's origin was not re-derived.
- **230** contacts with no name at all (first and last name both blank, live
  persons) whose email cannot be split reliably (`gusoliva@`,
  `maria.laura.fantoni@`, digits, initials), measured 2026-10-01. (Corrected
  2026-10-01: this said 233, "not re-verified this pass — no database access".)
  Needs another source (LinkedIn, enrichment) or a BD. Owner decision 2026-10-18: deferred, together
  with the 244 duplicate pairs, for a joint human review later; stays TODO.
- Duplicate pairs open in `/admin/duplicates` — see **duplicates queue**
  below; the "11 pairs" figure recorded here previously is stale (see that
  entry for why and for the current count).

### company-contact-counts
The `/companies` list's "Contactos" column and the company record's contacts
card match `person.company_key` directly instead of resolving through
`company_alias`, so both undercount. **Latent today** — `company_alias` has 0
rows (measured 2026-10-01). The fix is written and waiting on the branch
`fix/company-contact-count-alias` (one commit, `d2c1152`, dated 2026-09-28, on
`origin` and not merged into `main`; re-checked 2026-10-01); ship it the day an
alias is created. Code re-checked on `main`: `getCompanyContactCount` still
counts `where company_key = …` directly
(`src/lib/companies/queries.ts:123-125`), and the list's count is keyed by
`company_key` (`src/lib/companies/listQueries.ts:173-189`).

### argentina-day-boundary — shipped
Found by the launch-readiness audit (2026-09-30), fixed and merged the same
day (#247) — see **Shipped** above for the three bugs and their fixes.

### duplicates queue — 244 open, 98 merged, 2 dismissed (re-measured 2026-10-01)
Owner decision 2026-10-18: deferred for a joint human review later (with the 230 nameless
contacts); stays TODO.
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

Current counts, measured read-only against production on 2026-10-01 (they
match the 2026-09-30 figures — nothing in the queue has moved since):
**244 open, 98 merged, 2 dismissed** (`duplicate_candidate.status`:
`open` / `merged` / `not_duplicate`); **27,683 live contacts** (27,781 rows
less 98 merged away). (Corrected 2026-10-01: this said 27,528 active contacts;
the DFF and hotel imports and BD-created contacts came after it.) The 98 are 98
`merge_event` rows, none undone. Their breakdown (corrected 2026-10-01 — this
said "four passes … 70 and 4 … then 3 and 5 confirmed triangles", which does
not add up to 98 — and a triangle is two merges, not one): **70 and 4 = 74** by `scripts/merge-duplicates.ts --tier=safe` (runs
`e4f4a779`, `d097caed`, each with a `bulk_merge_duplicates_run` audit row), **16**
by `scripts/merge-triangles-2026-09.ts` (3 triangles in batch "a", PR #251, and 5
in batch "b", PR #254 — reason `confirmed_triangle_2026_09`), and **8** by neither,
by subtraction — presumably by hand in `/admin/duplicates` before the CLI existed
(first `merge` audit row 2026-09-30 18:47 UTC, the first CLI run 19:02); the 8
were not individually traced: unverified. The 2 dismissals were run `de3d64b7`, before the tier was retired;
both were verified by hand first as genuinely different people
(`juan.barrere`/`juan.vespa@pampaenergia.com`,
`jose.tanaka`/`jose.somale@tecpetrol.com` — different surname tokens in the
local part, which is the signal that actually separates the two groups).

Bucket breakdown of the 244 open pairs, from a `--tier=safe` dry run (read-only,
re-run 2026-10-01; output: "Open pairs analyzed: 244", 0 pairs matched the
`safe` tier):

| Bucket | Pairs | Why it is not automatic |
| --- | --- | --- |
| `classic_split_no_conflict` | 0 | all cleared |
| `classic_split_conflict` | 71 | job title or owner disagree |
| `one_email_not_classic` | 15 | one email, no complementary LinkedIn row |
| `two_emails_differ_unverified` | 8 | neither side verified |
| `no_email_titles_agree` | 46 | no email on either side |
| `no_email_titles_conflict` | 104 | no email AND the titles contradict |

(Corrected 2026-10-01: the previous table said 20 and 109 for the two rows
above, and its rows summed to 254, not 244. The dry run also reports 0 pairs in
`two_emails_same_mailbox`, `two_emails_same_mailbox_ambiguous` and
`two_emails_differ_verified`.)

The last two rows are the bulk of the queue: **150 pairs where neither side
has an email at all** (it said 155), matched only on name plus company, and 104
of those (it said 109) also have contradicting job titles. Those are as likely to be namesakes as
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
via `--revert=<runId>`. (`--revert` exists in `scripts/merge-duplicates.ts`,
and 0 of the 98 `merge_event` rows are undone as of 2026-10-01; "no time limit"
and "preserves … connections" were not exercised in this pass: unverified.)

### merges dropped phone numbers — 35 contacts, fixed and 34 recovered (2026-10-01)
Found while investigating the owner's report that the contacts list showed
people with no phone. The filter bug was separate (it shipped as #269/#270;
see **Shipped**); this was the other half, and it was worse, because it was
silent data loss.

`person.phone` and `person.mobile_phone` were NOT in the merge's tracked-field
list (then `TRACKED_FIELDS`, now `MERGE_TRACKED_FIELDS`,
`src/lib/identity/merge.ts:264`), so a merge never copied them onto the
survivor. Same class as the `profileKey` finding already recorded for survivor
choice. (Corrected 2026-10-01: this said the columns were "evidently" not in the
list — a guess when it was written; it was true then and is fixed now.)

Measured against production on 2026-10-01, before the fix:
- 98 rows have `merged_into_id` set.
- **35 survivors have no phone at all while the row merged INTO them does.**
  Over a third of every merge performed.

(The examples that used to be listed here — five named contacts with their
stranded phone numbers — were removed 2026-10-01: personal data does not belong
in the repository, and the run's audit row holds the exact fills.)

Two pieces of work, and they were independent — both are done:
1. **Recover the 35 — done 2026-10-01 13:28 UTC.** `scripts/restore-merged-phones.ts`
   run `a0d11319-81f7-4529-8051-e8ead1c5d626` (audit row
   `restore_merged_phones_run`): **35 fills across 34 persons**, 0 conflicts, 1
   skipped as invalid. Re-measured 2026-10-01 after the run: **1 survivor
   still has no phone** while its merged-away row holds a number — the value is
   dot-separated (`+54.9.11…`) and fails `src/lib/phone.ts` validation, so the
   script reports it and never writes it. That is the "35th". It needs a human to
   decide whether to normalize and restore it (Owner decision 2026-10-18: it will be normalized
  together with the E.164 work. Checked 2026-10-18 after the backfill: dotted
  `+54.9.11…` values were stripped by the backfill, but this one sits on a
  merged-away row and was NOT touched, because only live rows are processed; the
  survivor still has no phone); the merge happened 2026-09-30
   22:11 UTC, before the fix. (Corrected 2026-10-01: this said "recover the 35";
   the real figure is 34 recovered plus 1 invalid.)
2. **Stop it recurring — done (#272).** Both phone columns are in
   `MERGE_TRACKED_FIELDS` (`merge.ts:272-273`), fill-blank only. The suggested
   test exists: `tests/unit/mergePersonColumnCoverage.test.ts` enumerates every
   `person` column and forces a carry/do-not-carry decision for each. `profile_key`
   stays deliberately NOT carried (unique constraint; conversations resolve
   through the `merged_into_id` chain). `contact_type` was added to the carried
   list in #275.

(Corrected 2026-10-01: the earlier "Note for the 244 still-open duplicate pairs:
merging any of them today still loses the phone — fix item 2 before working the
queue further" and the "pending an owner-approved run" status are both obsolete.)

### pickEmailWinnerSide is a hand-copy, not a shared function — resolved (#255)
(Corrected 2026-10-01: this entry claimed `pickEmailWinnerSide` in
`src/lib/identity/duplicateTiering.ts` duplicates a private `mergeEmailFields`
rule "by hand, because the original is not exported", and that "another agent
may be working on this right now". The rule is exported as `pickEmailWinner`
(`src/lib/identity/merge.ts:310`), `mergeEmailFields` calls it
(`merge.ts:321`), and `duplicateTiering.ts` imports it (`:124`) and
`pickEmailWinnerSide` (`:353-358`) just resolves through it. Fixed in #255
(2026-09-30) and never reconciled here; `tests/unit/pickEmailWinner.test.ts`
pins that the two call sites agree by construction.) Nothing outstanding.

### 04-tasks launch-readiness failures were stale selectors, not a /tasks error — fixed (2026-10-13)
(Corrected 2026-10-13: `tests/launch-readiness/04-tasks.spec.ts` failed 5 tests
on a fresh seed and the cause was reported as a "Maximum array nesting exceeded"
on `/tasks`. That was wrong. Measured 2026-10-13 against a scratch database
`bd_tasks_bug_e2e` with a dev server whose log was captured: every `GET /tasks`
(and `?view=all`) answered 200, the log held zero error lines, and the seven task
queries the page calls (`getTaskViewCounts`, `listOwnerOptions`,
`getOpenTasks`, `getAllOpenTasks`, `getOverdueTasks`, `getAllOverdueTasks`,
`getCompletedTasks`) all returned rows when called directly. The string
"Maximum array nesting exceeded" belongs to the unrelated 1.1 MB-note case in
finding F1, `openspec/changes/launch-readiness-pass/README.md:31`.)
The real cause: `ffe2edd` (2026-10-03) replaced the complete-task checkbox with
`DoneButton` (`src/components/DoneButton.tsx`, `aria-pressed`, `disabled` when
done), but five specs still looked for `getByRole('checkbox')`
(`04-tasks.spec.ts` at the lines for complete, other-BD complete, double-click,
Completadas, stale click), and `tests/e2e/phase1.spec.ts:28` and `:40` did the
same. Fixed by selecting `getByRole('button', { name: 'Completar', exact: true })`
and asserting `aria-pressed` instead of `toBeChecked`. No app code changed.
Result 2026-10-13: `04-tasks.spec.ts` 5 failed / 11 passed before (setup project included), 16 passed
after; `phase1.spec.ts` "Tasks page" 2 failed / 0 passed before (against a
database that has tasks), 2 passed after.
Latent until now: `phase1.spec.ts` only asserts the control when the list is
non-empty, so it passed on the empty `bd_contact_intel_e2e` but would have
failed on any database with open tasks, production included (unverified: not run
against production, which had 24 task rows on 2026-10-01).
Not measured: no production query was run, because there is no data-shaped
trigger to look for.

### task.lead_id and task.contact_id — dead legacy columns, recommendation: drop both
Same shape for both columns, no user can reach either. `task.contact_id`
(`src/db/schema.ts:1175`, indexed as `task_contact_idx` at `schema.ts:1198`) and
`task.lead_id` (`schema.ts:1171`, `task_lead_idx` at `:1196`) are **selected** on
every task read (`src/lib/tasks/queries.ts:40`, `:42`, `:325`, `:327`) but **not
joined** — the task list queries left-join only `bd`, `person` and `company`
(`queries.ts:64-66`, `:351-353`). No write path ever sets either:
`createTaskAction` declares both in its input type
(`src/app/(app)/tasks/actions.ts:26`, `:28`), but none of its three callers
(`NewTaskButton.tsx:127`, `contacts/actions.ts:196`, `companies/actions.ts:166`)
passes them, and bulk create never touches them. Neither is in
`TaskSubjectInput` (`src/lib/tasks/subject.ts`), so no renderer consults either.
Both are pre-Unified-Contact legacy columns superseded by `person_id`.
**Measured 2026-10-01: both columns are set on 0 of 24 `task` rows** (the owner's
earlier measurement was 0 of 20). (Corrected 2026-10-01: this entry said
`contactId` is "selected and joined on every task read" and cited
`schema.ts:1157`/`:1180`; it is selected only, and those lines had moved.)

**Recommendation (PR #291, `openspec/changes/task-subject-columns/README.md`):
drop both, in two steps** — first a code PR that removes the dead plumbing
(about 25 production lines deleted, none added; the columns stay), then a
migration, after owner approval, that drops them. Order matters: the migration
must not ship before the code PR, because the fold/catch-up raw SQL still
references the columns and would start failing. Do not build a write path: a task
on a lead is already expressible as a task on that lead's person. Scope is `task`
only — the twin columns on `activity`, `signal` and `linkedin_scrape_job` are NOT
dead and must not be dragged in. Nothing is applied; the owner decides, because
dropping a column in production is irreversible. The README states that it used
no database access (only the owner's measurement); the 0-of-24 figure above is
the first measured one. A new migration will also need a hand-set journal `when`
— see **drizzle journal is future-dated** below.
Owner decision 2026-10-18: drop APPROVED. Code commit (reads/writes removed) and
migration `drizzle/0050_task_drop_legacy_subject_columns.sql` (+ `_rollback.sql`) are
built; NOT yet applied to production.

### hotel-phone-dial-codes — 15 contacts whose dial code disagrees with their country (2026-10-01)
The hotel import stored each number as it arrived and flagged rows whose dial
code does not match the row's country. Re-measured 2026-10-01 with the read-only
`scripts/report-hoteles-data-quality.ts` (counts only, no names): **15 contacts**
(17 numbers); the report prints 2 impossible for their prefix (wrong length), 5
shared by several contacts (probably a switchboard) and 12 with a plausible
format from another country that needs a human look — these are overlapping
lenses, not a partition of the 15. The row-by-row
judgement is in `openspec/changes/hoteles-data-quality/README.md` §1 (it carries
no names or numbers — rows are identified by their position in the sheet): 6
plausible foreign numbers, 4 to verify before calling, 1 near-certain typo (a
`+55` Brazil prefix on what looks like a Mexico City number — the digits match
except 52 → 55), 3 unusable, 1 probably wrong. In 5 rows the contact has another
good number, so the bad number is the thing to drop, not the contact. **Nothing
was changed**; confirming the typo needs a first call. The README's per-row
judgements are format-based inference, not calls: unverified beyond the counts.
Owner decision 2026-10-18: leave the 15 as they are. The E.164 backfill ran
2026-10-18 (see **click-to-call**); these 15 were not part of a decision to
change, so they stay as is.

### hotel-role-groups — 51 contacts in `role_group: other`, and a vocabulary gap in `classifyPosition` (2026-10-01)
Measured 2026-10-01 over the 147 hotel contacts: `sales_bd` 51, `other` 51,
`c_level_business` 36, `operations` 6, `eng_leadership` 3. The 51 in `other` are
**visible** (that group sits under "Revisar", not under the default-hidden
`developers`/`sales_bd`) but unclassified. By the README's reading of their
titles, about 21 are general-management/ownership titles ("Director General",
"Consejero delegado", "Direttore", "Proprietario", …) that `classifyPosition`
already handles in English ("General Manager" → `c_level_business`) but not in
Spanish/Italian/German; about 17 are Revenue/distribution/reservations, 4
Finance, 5 guest/event operations, and ~3 are unclassifiable.
**Recommendation: add hospitality vocabulary to `classifyPosition`** (the ~21
general-management terms to `c_level_business`; a decision from the owner on
Revenue, Finance and guest operations), recomputed with
`scripts/backfill-role-groups.ts` after a dry run — **and do not route Revenue
into `sales_bd`**: that is the group the default view hides, so it would hide
about 17 more hotel contacts (51 → ~68) from the list Mariel works. The
README recommends not creating a dedicated hotel group yet. Not implemented;
`classifyPosition` and the hide rule are unchanged.
Owner decision 2026-10-18: leave the Revenue, Finance and guest-operations hotel
roles as they are (no change).

**Correction to the README's headline finding** (2026-10-01, after #284): the
README says 51 of 147 hotel contacts do not appear in Mariel's default view,
because `sales_bd` is hidden. That figure ignores the exception it mentions two
paragraphs later. Since #284, a `BUYER-CHAMPION` contact is never hidden by the
role-group default (`roleVisibility.ts:67-80`), and of the 51 `sales_bd` hotel
contacts **46 are `BUYER-CHAMPION` and 5 are `INFLUENCER`** (measured
2026-10-01). So **5, not 51**, are hidden from the default view today; the
report script's "51 de 147" counts role groups only and was not updated.
The default-hidden set across the whole database is 6,122 live persons in
`developers` + `sales_bd` before the exception (measured 2026-10-01).

### css: `.filter-submit` and `.danger` look right only because of an inherited accent fill (2026-10-01)
Owner-reported; partly confirmed. `globals.css:495` styles every bare button
with `:where(button) { background: var(--color-accent); … }` at zero
specificity, and a class that declares no `background` silently inherits it —
the mechanism behind the `.menu-item` bug fixed in #283 (a red box with dark
ink on an enabled button; it looked correct when disabled and wrong when
enabled, exactly backwards). Re-checked on `main` 2026-10-01:
- **`.filter-submit` (`globals.css:885-891`) declares only `flex`, `height` and
  padding — no `background`, no `color`.** The filter-form submit buttons on
  `/contacts`, `/` and `/hiring` (`contacts/page.tsx:747`, `(app)/page.tsx:188`,
  `hiring/page.tsx:93`) get their look entirely from `:where(button)`. Confirmed
  by reading the CSS; not measured in a browser.
- **`.danger`: partly.** The only bare `className="danger"` button is the
  unmerge confirm (`admin/duplicates/page.tsx:156`), and it is skinned by a
  scoped rule, `.duplicates-unmerge-confirm button.danger`
  (`globals.css:1409-1412`, an explicit `var(--color-danger)` background) — so
  there it is **not** accidental. But the rule is scoped to that one container;
  there is no global `.danger` skin, and a `.danger` button anywhere else would
  fall back to the accent fill. That would *look* right only because the accent
  (`#d5252f`, `globals.css:25`) is nearly the danger red (`#dc2626`, `:60`). The
  other `danger` class in the app, `.qa.danger` (`QuickActions.tsx:208`), is a
  different component with its own `background: none` base.
**Fixed (2026-10-03, `fix/explicit-button-skins`).** `.filter-submit` now has an
explicit background/color pair plus its hover/active/disabled states, and the
danger skin is the global `button.danger:not(.qa)`. Appearance unchanged (before
and after screenshots byte-identical in a standalone harness). Drift found: the
`/contacts` submit is at `contacts/page.tsx:754`, and `.filter-submit` is also
used by `admin/rfc-backfill` and `admin/migration`.

### drizzle journal is future-dated to 2026-10-20 — every new migration needs a hand-set `when`
`drizzle/meta/_journal.json` has 41 entries (re-counted 2026-10-13; this said
36, measured 2026-10-01, before 0036-0040 landed). The timestamptz chain was
future-dated on purpose (one day per slice), and the last entry —
`0035_bd_signature_html` — has `when` = 1792527871556 = **2026-10-20T20:24:31Z**.
Production's latest applied migration `created_at` is the same value (measured
2026-10-01: `drizzle.__drizzle_migrations` holds 36 rows, max `created_at`
1792527871556; re-measured 2026-10-13: **41 rows**, max `created_at`
**1792959871556**, so the journal and production are in sync and later entries
were hand-stamped past the 2026-10-20 value as this entry instructs). `drizzle-kit migrate` compares each entry's `when` with the
latest applied `created_at` and **silently skips any entry that is earlier** —
that is how 0012 and 0013 were skipped once. So until the real clock passes
2026-10-20, a new migration's `when` must be set by hand to something greater
than 1792527871556; `drizzle-kit generate` stamps the current time and would be
skipped. `tests/unit/drizzleJournal.test.ts` enforces strictly increasing `when`
and its failure message says how to fix it (`src/lib/migration/journalWhen.ts`,
#279). Nothing to fix; recorded so nobody rediscovers it by losing a migration.

### `db:migrate` could not build the database from empty — fixed 2026-10-13: use `db:migrate`, never `db:push` (2026-10-13)
The first three paragraphs are the finding as first written, kept as history; the
fix and the current recipe are in the "Fixed 2026-10-13" paragraph and the
recipe below it.

Found while rebuilding `bd_contact_intel_e2e`. Against a **freshly created empty
database**, `npm run db:migrate` fails with `PostgresError: relation "contact"
does not exist` (`42P01`): an early entry in the chain assumes a table a later
migration creates, so the chain is no longer replayable in order. This is the
same root cause area as the entry above — the `when` values were hand-set per
slice, so the journal's order is artificial and no longer reflects the SQL's
dependency order.

**At the time there was therefore no tested path from an empty database to the
current schema (no longer true after the fix below).** Nobody noticed because production grew one migration at a time and
never replayed the chain, and because the e2e scratch database had **0 rows** in
`drizzle.__drizzle_migrations` — it had been built with `db:push` from the start.
The two facts hid each other.

**Do not use `db:push` — this was the original workaround and it is wrong.**
It syncs `src/db/schema.ts` directly and did produce 37 tables matching production
table-for-table, including the post-0039 `company_alias.company_key -> company` FK
(its only output was a harmless `42622` NOTICE about a constraint identifier
truncated to Postgres's 63-character limit). But `src/db/schema.ts` declares no
RLS, so a `db:push` database has row-level security **off on all 37 tables**; see
"What was measured" below. Same ruling as `README.md`, "Standing up a new
environment".

Recipe that works (updated 2026-10-13 to the chain-built path; the original used `db:push`):
```
dropdb bd_contact_intel_e2e && createdb bd_contact_intel_e2e
DATABASE_URL='postgres://localhost:5432/bd_contact_intel_e2e' npm run db:migrate
DATABASE_URL='postgres://localhost:5432/bd_contact_intel_e2e' \
  E2E_EMAIL="$(grep -o 'E2E_EMAIL=.*' .env.local | cut -d= -f2-)" \
  npx tsx scripts/seed-launch-readiness.ts --execute
```
Two traps: **always pass `DATABASE_URL` explicitly** (drizzle-kit auto-loads
`.env`, where the production URL lives, so a bare `db:migrate` (or `db:push`) points
at production), and `E2E_EMAIL` lives in `.env.local`, not the `.env.e2e.local`
the seed auto-loads — pass it on the command line rather than sourcing
`.env.local`, which would bring the production `DATABASE_URL` with it.

**Fixed 2026-10-13 (`main`, work units `fix(db): create bd and contact…` and
`fix(db): guard the Supabase-role revoke…`).** `npm run db:migrate` now builds
the schema from an empty database, proven by running it, and `db:migrate` — not
`db:push` — is what a new environment should use (`README.md`, "Standing up a
new environment").

**The framing in this entry was wrong.** It is not that an early entry assumes a
table a later migration creates: **no migration in the chain ever creates `bd`
or `contact`** (re-checked 2026-10-13: `rg -i 'create table (if not exists )?"(contact|bd)"' drizzle/`
returns nothing). Both tables were created by `drizzle-kit push` before the
chain existed, as `drizzle/0000_crazy_wind_dancer.sql:1-7` said all along, so
the chain had no genesis at all. A static replay of the chain found exactly
**56 statements** across 16 files touching a missing table, and exactly **two**
distinct missing tables — `bd` and `contact`, nothing else. (Corrected 2026-10-13:
this said 27. That figure came from the first, broken version of the guard, whose
splitter blanked a standalone `--> statement-breakpoint` line before splitting,
so most files collapsed into one chunk. Re-derived with the current guard against
the pre-fix chain at `91ebed0^` and at `5832862`: 56 statements, 16 files, tables
`bd` and `contact`. The file count and the table set never changed.)

Two root causes, both fixed by editing already-applied files:
1. `drizzle/0000_crazy_wind_dancer.sql:22-57` — added the genesis
   `CREATE TABLE IF NOT EXISTS "bd"` / `"contact"`, their FK, unique
   constraints and four indexes, transcribed from
   `drizzle/meta/0000_snapshot.json` (the recorded schema state at idx 0) minus
   `role_group` and its index, which 0000 adds itself. Every statement is
   `IF NOT EXISTS` / `duplicate_object`-guarded.
2. `drizzle/0019_enable_rls.sql:86-90` — the final
   `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON TABLES FROM anon, authenticated`
   raised `role "anon" does not exist` (`42704`) on a plain Postgres, because
   `postgres`, `anon` and `authenticated` are Supabase roles (measured
   2026-10-13: local PostgreSQL 16.14 has none of the three). It is now wrapped
   in a `DO` block that runs it only when all three roles exist.

A squashed baseline migration was **rejected**. Placed first it would be
followed by the existing chain re-running its ALTERs over a complete schema,
and several of those are not idempotent (`drizzle/0012_fantastic_iceman.sql:72`
is a bare `ALTER TABLE "contact" ADD COLUMN "email_status"`, which raises
`42701`). Making it the *only* journal entry would instead strand
`drizzle/meta/*_snapshot.json` and the `idx`-to-snapshot invariants that
`tests/unit/drizzleJournal.test.ts:50-66` enforces. Prepending a new entry was
also rejected: `drizzle/meta/_journal.json` `idx` values must stay sequential
(`tests/unit/drizzleJournal.test.ts:33`) and each `idx` must have a matching
`NNNN_snapshot.json` whose `prevId` chains, so inserting at the front means
renumbering all 41 entries and renaming 34 snapshots. Repairing the files in
place needs no journal change at all.

### Production-safety proof for the two edited migration files

**The migrator's real rule, read from source (2026-10-13), as shipped in
drizzle-orm 0.36.4** (`node_modules/drizzle-orm/package.json`; `package.json` pins
`^0.36.4`, so drift is bounded to patch releases). Everything in this proof is a
property of that version: re-read `PgDialect.migrate` before bumping drizzle-orm
past 0.36.x. `npm run db:migrate` is `drizzle-kit migrate`. `node_modules/drizzle-kit/bin.cjs:88508`/`:88542-88543` hands
off to `preparePostgresDB`, which at `:76402-76409` picks
`drizzle-orm/postgres-js/migrator` because `pg` is not installed and `postgres`
is (confirmed by the run's own line, `Using 'postgres' driver for database
querying`). That migrator is three lines: `readMigrationFiles` then
`db.dialect.migrate`. The decision lives in
`node_modules/drizzle-orm/pg-core/dialect.js:44-71`:

```js
const dbMigrations = await session.all(
  sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`);
const lastDbMigration = dbMigrations[0];
await session.transaction(async (tx) => {
  for await (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { …apply… }
```

So, precisely:
- **The hash is written but never compared.** It is `insert`ed at `:67-69` and
  the only column read back is `created_at`. Changing a `.sql` file's contents
  cannot change what any existing database replays. (`folderMillis` is the
  journal `when`, `node_modules/drizzle-orm/migrator.js:22`.)
- **The gate is a single high-water mark**, `max(created_at)`, read once before
  the loop: an entry applies iff its journal `when` is strictly greater.
- **On an empty database `lastDbMigration` is undefined, so every entry applies,
  in journal array order** — `when` is irrelevant there. That asymmetry is why
  the chain must be dependency-ordered even though the `when` values are
  hand-set.
- The whole run is one transaction, so a failed replay leaves nothing behind.

**Therefore both edits are no-ops in production.** `0000` (`when`
1789503871556) and `0019` (`when` 1791145471556) are below production's latest
applied `created_at` of **1792959871556** (41 rows, measured read-only
2026-10-13, recorded in the entry above), so `db:migrate` skips both files
without reading them, and their changed hashes are never compared against the
ledger rows already stored. No `CREATE TABLE` can reach the live database. The
journal itself is **untouched**: same 41 entries, same `idx`, same `when`,
`git diff` on `drizzle/meta/` is empty.

**The no-op was then rehearsed, not just argued (2026-10-13).** Replaying the
fixed chain onto an empty database produces a `drizzle.__drizzle_migrations` of
**41 rows, min `created_at` 1789503871556, max 1792959871556** — the same row
count and the same high-water mark production records, so that scratch database
is a faithful stand-in for production's ledger. Running `npm run db:migrate`
against it a **second** time, with the edited `0000` and `0019` on disk,
applied nothing:

- ledger before and after: 41 rows, max `created_at` 1792959871556, and
  `md5(string_agg(hash||':'||created_at order by id))` =
  `fdf6bf8cc47bc4fd5940a4a0149eeb71` **both times**. The stored hashes did not
  change even though the two files' contents did, which is the "hash is never
  compared and never updated" claim, measured.
- total server output of the repeat run: two notices,
  `42P06 schema "drizzle" already exists, skipping` and
  `42P07 relation "__drizzle_migrations" already exists, skipping`. Those come
  from the two unconditional statements at
  `node_modules/drizzle-orm/pg-core/dialect.js:51-55`. **No migration SQL ran
  at all.**

I did not read production myself in this pass (production is read-only for this
task and I did not open `.env`/`.env.local`): the 41-row / 1792959871556 figures
are the ones measured read-only on 2026-10-13 and recorded in the entry above,
so for this entry they are **unverified by me**. The proof depends on exactly
one property of production — that its `max(created_at)` is at least
1792959871556 — and that is worth re-reading before the first `db:migrate`
against production after this change. If it were somehow *lower*, the effect
would still not be a `CREATE TABLE` over live data: every statement in the
genesis block is `IF NOT EXISTS` / `duplicate_object`-guarded.

### What was measured (2026-10-13)

Before: `DATABASE_URL='postgres://localhost:5432/bd_contact_intel_migrate_check' npm run db:migrate`
on a freshly created database → `PostgresError: relation "contact" does not
exist` (`42P01`) on the first statement; 0 tables created (one transaction).
After the genesis fix → `role "anon" does not exist` (`42704`). After both
fixes → `[✓] migrations applied successfully!`, 41 ledger rows.

The result was diffed against a second scratch database built with
`npm run db:push` from `src/db/schema.ts`:

| Catalog comparison | migrate vs push |
| --- | --- |
| `information_schema.tables` | **37 = 37, identical** |
| `information_schema.columns` (name, type, nullability, default, length, precision) | **identical** |
| `pg_indexes` (name + full `indexdef`) | **133 = 133, identical** |
| `pg_constraint` (name + `pg_get_constraintdef`) | **9 differences, all pre-existing** |
| `pg_class.relrowsecurity` | migrate 37 on / push 0 on |

The 9 constraint differences are drift between the hand-written migrations and
`src/db/schema.ts`; they are not introduced by this fix and the migrate-built
side is the one that matches production, because production was built by these
same files:
- **5 foreign keys are named by Postgres, not by drizzle** —
  `conversation_bd_id_fkey`, `message_bd_id_fkey`,
  `message_conversation_id_fkey`, `job_posting_company_key_fkey`,
  `sync_run_company_key_fkey` (vs `conversation_bd_id_bd_id_fk` etc. from
  push). The hand-written `0002`/`0004` declared those FKs inline without a
  name.
- **4 uniques are plain unique indexes instead of unique constraints** —
  `board_candidate_ats_slug_unique`, `conversation_bd_external_unique`,
  `job_posting_company_external_unique`, `message_bd_content_hash_unique`.
  Same name, same columns, same unique btree index in both databases; only the
  `pg_constraint` row is absent. Uniqueness and `ON CONFLICT (cols)` behave
  identically, and nothing in `src/`, `scripts/` or `tests/` uses
  `ON CONFLICT ON CONSTRAINT` or references a constraint name (re-checked
  2026-10-13).
- RLS: `db:migrate` ends with row-level security **on for all 37 tables**, and
  `db:push` leaves it **off on all 37**, because `src/db/schema.ts` declares no
  RLS. So on this axis the migrate path is the production-like one and `db:push`
  silently reopens the hole `0019` closed. Good news checked while measuring
  this and worth recording, because the opposite was the obvious guess: the
  chain does cover the tables created after `0019`. The 31 tables in
  `drizzle/0019_enable_rls.sql` plus `task_digest_send`
  (`drizzle/0020_task_digest_send.sql:28`), `follow_up_queue_item`
  (`0023_follow_up_queue.sql`), the three email tables
  (`0025_email_message_tables.sql`) and `company_absorption_proposal`
  (`0040_company_absorption_proposal.sql`) make exactly 37.

Regression guard: `tests/unit/drizzleChainReplay.test.ts` replays the chain
statement by statement and fails if any statement touches a table no earlier
statement created (`src/lib/migration/chainReplay.ts`). It was RED at 56
findings before the fix (re-derived 2026-10-13; the 27 first published here was an
artifact of the broken splitter, see above, not a change in the chain).

**Hardened the same day after review.** The first version matched only quoted
identifiers, so `drizzle/0039_company_alias_fk_to_company.sql:18,21`
(`ALTER TABLE public.company_alias`, unquoted, inside `DO`/`EXECUTE`) was invisible
to it, and a later migration copying that style while omitting its `CREATE TABLE`
would have passed. It now reads quoted and bare names, with or without `public.`;
ignores other schemas; replays events in source order inside one statement (a
reference before its `CREATE` is caught); clears a table on `DROP TABLE`; also
checks `DELETE FROM`, `TRUNCATE`, `COMMENT ON TABLE` and unnamed or bare-named
`CREATE INDEX`; and splits on standalone `--> statement-breakpoint` lines, which
the first version stripped as comments (so most of each file was one "statement").
Deliberately NOT covered, because the chain uses none of them and each needs real
parsing: `GRANT`/`REVOKE ... ON TABLE`, `CREATE TRIGGER ... ON`, a view's `FROM`,
`CREATE TABLE ... (LIKE x)`, `RENAME TO`, and tables created inside `EXECUTE`.
**It checks tables only.** A missing column, enum, extension, function or ROLE is
invisible to it; the second blocker that actually broke the build (the `anon` role
in `0019`) would have passed it. The only proof that the chain builds from empty is
still running `db:migrate` against an empty database; there is no CI in this repo. Suites after the fix (measured 2026-10-13, before the second hardening below): `test:unit` 3037/3037 pass,
`test:db` 6/6 pass against a migrate-built database, `typecheck` clean,
`npx next build` compiles through page-data collection.

**Second hardening, 2026-10-13 (`9dd0572`), after a fresh review ran the real
exported function against hand-written inputs.** Closed, each pinned by a test in
`tests/unit/drizzleChainReplay.test.ts`:
- *False negative, the dangerous direction:* comments were stripped in two passes
  (`/* */` first, then `--` lines), so `-- see /* below` opened a block comment that
  swallowed real SQL up to the next `*/`. Now one left-to-right pass: block
  comments nest, and `--` inside a string or quoted identifier is not a comment.
- *False negative:* `TRUNCATE a, b` reported only `a` (the comma list existed for
  `DROP` only).
- *False negative:* `INSERT INTO a SELECT … FROM g`, `UPDATE a SET … FROM g` and
  `DELETE FROM a USING g` reported only `a`. Backfill migrations such as `0034` are
  where this would have appeared.
- *False positive:* `GRANT … UPDATE ON TABLE a`, `REVOKE UPDATE ON …`,
  `GRANT REFERENCES, TRUNCATE ON …` and `AFTER TRUNCATE ON a` reported a table
  named `on`; a trailing `-- references company` or `; -- ALTER TABLE ghost` reported
  `company` / `ghost`.

Documented, not fixed (module comment in `chainReplay.ts`): string literals and
dollar-quoted bodies are scanned as SQL; `::regclass`, `CREATE POLICY … ON`,
`CREATE/DROP TRIGGER … ON`, `LOCK TABLE`, `COPY`, `INHERITS`, `PARTITION OF`,
`COMMENT ON COLUMN/CONSTRAINT`, `CREATE TABLE … AS SELECT` are unchecked; after
`RENAME TO` the old name stays "existing"; rare fakes `of` and `all`; and inside a
write statement any `FROM x` is read as a table (`EXTRACT(epoch FROM col)`, a CTE
name). Over-reporting is the accepted direction. The real chain still reports 0.
`test:unit` after this change: 3068/3068 (2026-10-13, with other commits in the tree).

### Free-mail is two predicates now: LATAM ISP roots are still refused for matching, no longer for company edits (2026-10-13)
Commit `5832862` split the free-mail test in two because the two callers pay
opposite prices for being wrong:
- `isFreeMailDomain` (`src/lib/emailPatterns.ts:92`, broad) — pattern inference,
  identity matching, merge ranking. A false negative **merges two strangers** who
  both used an ISP mailbox, so it stays aggressive.
- `isUnownableMailDomain` (`src/lib/emailPatterns.ts:190`, narrow, backed by the
  literals `UNOWNABLE_MAIL_ROOTS` at `:120` and `UNOWNABLE_MAIL_DOMAINS` at `:177`)
  — used only by the company-domain
  validator (`src/lib/companies/domain.ts:117`). A false positive **blocks a
  legitimate BD edit**, so it is narrow.

The six LATAM ISP roots `terra`, `uol`, `bol`, `speedy`, `fibertel`, `arnet` are in
the broad set only. The owner confirmed none of them is a real or prospective
client. Measured 2026-10-13 (production, read-only; the queries are not recorded
in this file): **0 companies** with a domain on any of the six roots; exactly
**1 person** with an `@fibertel.com.ar` address. `test:unit` was 3037 pass / 0 fail
on that commit (measured 2026-10-13).

**CLOSED — the exact-domain half is split too.** The narrow predicate used to reuse
the exact-domain set `FREE_MAIL_DOMAINS`, which carried the SAME asymmetry the roots
literal exists to avoid, one level down: an entry meant only to be excluded from
*matching* silently started blocking *company edits*. `isUnownableMailDomain` now has
its own `UNOWNABLE_MAIL_DOMAINS` literal and inherits nothing.

Four `FREE_MAIL_DOMAINS` entries are not covered by `UNOWNABLE_MAIL_ROOTS`, because
their first label is an ordinary word and not the provider's brand:
- `me.com`, `mac.com` — Apple's consumer iCloud aliases. No known company is
  recorded as "me.com"; Apple is `apple.com`. Still refused.
- `mail.com` — a consumer webmail brand (operated by 1&1 Mail & Media, a United
  Internet subsidiary). Kept refused as the **conservative default**, not because
  anyone measured it. Reverse it if a real counterpart ever shows up.
- `zoho.com` — **no longer refused.** Zoho Corporation is a live company whose own
  domain is zoho.com. It stays free mail for MATCHING (`isFreeMailDomain` still
  refuses it), which is where the damage would be, since Zoho Mail also hosts
  consumer mailboxes.

**Known inconsistency, named rather than hidden (raised by the pre-push review,
2026-10-13).** The reasoning above decides those four entries and NOTHING else.
`proton.me` (Proton AG), `yandex.com` (Yandex), `aol.com`, `outlook.com` and
`icloud.com` are also their operators' own domains, and they stay refused purely
because their first label is in `UNOWNABLE_MAIL_ROOTS` — the roots rule is coarser
than any criterion the comment states, and it wins. So `zoho.com` is permitted by
an accident of the first-label rule, not by a principled test applied across the
board. **Open, no owner decision yet:** whether the validator should also stop
refusing `proton.me` and `yandex.com`. Owner decision 2026-10-18: keep refusing both as company
domains; no change. Widening it has a measured cost on the
matching side and is a separate call — do not re-open them on the strength of the
zoho.com reasoning alone.

Behaviour changed for exactly one input: `zoho.com`. Only one caller reads the narrow
predicate (`src/lib/companies/domain.ts:117`), so the blast radius is that validator
alone; the HubSpot import deliberately uses the broad one.

Both tripwires in `tests/unit/freeMailSplit.test.ts` were verified to FAIL by
temporarily adding `tutanota.com` to one list at a time (2026-10-13): added to the
broad set alone, "every broad exact domain the narrow roots miss is classified on
purpose" fails (1 of 9 failing); added to the narrow set alone, BOTH that test and
"the narrow set is a subset of the broad one" fail (2 of 9). The probe was reverted
and `rg -c tutanota src/ tests/` returns nothing.

**Not measured:** how many production companies carry `zoho.com`, `me.com`,
`mac.com` or `mail.com` as their domain. No agent in that session had a
`DATABASE_URL`, and `.env*` is blocked by design. The read-only query is
`select domain, count(*) from company where domain in ('zoho.com','me.com','mac.com','mail.com') group by domain;`
Closed 2026-10-18: this query only supported the zoho decision, which the owner
dropped; it will not be run.

**Pre-existing gap in the BROAD list, found while doing this and deliberately NOT
widened:** `zoho` is not in `FREE_MAIL_ROOTS`, so the broad predicate only ever
caught `zoho.com` exactly — `zoho.eu` and the other country variants already slip
through identity matching. Adding the root would have a measurable cost (it would
stop Zoho-hosted contacts from being matched at all) and is a separate decision.
Dropped by owner 2026-10-18 ("no me sirve zoho, sacalo"): `zoho` is not added to
`FREE_MAIL_ROOTS`; no change.

**Worry checked, first answer WRONG, corrected 2026-10-13: "a company on
`fibertel.com.ar` would swallow every Fibertel customer."** An earlier version of
this entry said nothing attaches a contact to a company by `company.domain`. That
is false: the HubSpot import does exactly that. See **"HubSpot import matches and
groups companies by domain with no free-mail guard"** below; it was a real defect
(fixed, see that entry), not a settled worry. Readers of `company.domain` that are *not* a problem, read
2026-10-13, each at the cited line:
- `src/lib/identity/matcher.ts:115-116` reads the **person's** email domain, for
  the own-company skip only.
- `src/lib/companies/searchCondition.ts:42` is the company search box.
- `src/lib/contacts/companyDomain.ts` is display (the contact record's "Empresa" card).
- `src/lib/accounts/accountTypeBackfill.ts:306-315` (`findCrossNameEmailDomainOverlaps`)
  groups the domains of the emails found in **account notes**, not person email
  domains (an earlier version of this entry said person domains). It only reports
  overlaps; it attaches nothing.
- `src/lib/companyDomain.ts` guesses a domain from a company *name* for
  `src/lib/emailSuggestion.ts:14`.
- `src/lib/identity/emailPatternInferenceBackfill.ts:219` reads `company.domain`
  (through `src/lib/identity/emailPatternInferenceBackfillDb.ts:77`) but is guarded
  by the broad `isFreeMailDomain` at `:324`, so a BD-saved ISP domain is skipped
  there ("personal_domain"). Mitigated.

Unverified: I still did not search the whole repo for every reader of
`company.domain`; the list above is what was read, plus the HubSpot path below.

### HubSpot import matches and groups companies by domain with no free-mail guard (found 2026-10-13, FIXED 2026-10-13)
**Fixed 2026-10-13, see "Fix applied" at the end of this entry.** The text below
describes the defect as found. The HubSpot company import attaches
rows to existing companies, and merges rows with each other, by domain, and none of
that code asks whether the domain is free mail. All lines read 2026-10-13:
- `src/lib/hubspot/companies.ts:128-139` `normalizeDomain` lowercases and strips
  scheme, `www.`, path, port and trailing dot. No free-mail check. Neither
  `isFreeMailDomain` nor `isUnownableMailDomain` appears anywhere in that file.
- `:240` `groupHubSpotCompanies`: a union-find that merges rows sharing at least one
  normalized domain, primary or additional. Two unrelated HubSpot companies that
  both carry `fibertel.com.ar` land in ONE group.
- `:346` `planCompanyResolution`: `existingByDomain` is built at `:352` and filled at
  `:379`; `:423` `matched = existingByDomain.get(d)` matches an existing company BY
  DOMAIN (`matchReason: "domain"`, `:426`). `domainClaimedByOtherCompany` (`:203`)
  only prevents writing a domain another company already owns
  (`company_domain_idx`, a partial unique index, `drizzle/0015_company_domain.sql:2`).
  `own_company` is handled (`:414`); free mail is not.
- It is live code: `src/lib/hubspot/planner.ts:201` (the import planner),
  `scripts/backfill-company-domains.ts:126` (which WRITES `company.domain`, `:153`),
  `scripts/backfill-hubspot-company-fields.ts:91`, `scripts/unify-contacts.ts:280`.

**Why it matters now.** Since `5832862` a BD may save an ISP domain such as
`fibertel.com.ar` on a company (the narrow predicate allows it). That company then
owns the domain, and the next import or backfill that sees a HubSpot company with
that domain matches it to this one, pulling in unrelated contacts and companies.

**Reachability, stated honestly.** The HubSpot import has run once (2026-09-26,
5,867 rows). It is not a scheduled job, so nothing fires today; the risk lands on
the next import. `scripts/backfill-company-domains.ts` is the likeliest trigger
because it writes domains. Whether the HubSpot export carries any free-mail or ISP
domains at all: unverified (not measured; the export is PII and was not opened for
this entry). As of 2026-10-13 production has 0 companies on any of the six ISP roots,
so no exposure exists in the data today.

**Fix applied (2026-10-13).** The BROAD `isFreeMailDomain` now guards the three
places `src/lib/hubspot/companies.ts` uses a domain as identity, at the call sites;
`normalizeDomain` is untouched because it also feeds storage.
- Grouping: `groupHubSpotCompanies` unions rows only on non-free-mail domains. A
  `CompanyGroup` now carries `domains` (identity-eligible only) and `freeMailDomains`.
- Matching: `existingByDomain` never indexes a free-mail domain, so no row can match
  or "claim" one, whoever stored it. The row falls through to name/compact, exactly
  as a domain-less row does.
- Filling: fills and created companies take `group.domains[0]`, which is never a
  free-mail domain.
- `own_company` still reads every domain, free mail included, so it is unchanged.
- Visibility: `freeMailDomainsSkipped` on the resolution result and on the report's
  `warnings` (not shown in the admin table; absent on reports persisted earlier), and
  a line in `scripts/backfill-company-domains.ts` output.
The asymmetry is deliberate: a BD may SAVE `fibertel.com.ar` on a company, no
importer may MATCH, GROUP or INFER on it.

**Existing damage, measured read-only against production 2026-10-13.** Of 2,701
companies with a non-null domain, 1 holds a domain `isFreeMailDomain` flags:
`hotmail` -> `hotmail.com.ar`, 1 contact. 0 on any of the six ISP roots. No two
companies share a free-mail domain. **RESOLVED (2026-10-18):** it is already
cleaned up in production. `scripts/clear-non-company-employers.ts` deleted it: the
`clear_non_company_employers` audit_log row of 2026-10-13 12:27 UTC lists it in
`deletedCompanies` (key `hotmail`, domain `hotmail.com.ar`, 1 person, 0 leads/tasks/
activities), and `select ... from company where domain='hotmail.com.ar'` returns 0
rows today. Owner decision 2026-10-18: it was a person, not a company (confirmed by the owner); cleanup approved.

### e2e suite runs against production
Found while reconciling #287: the revived e2e suite logs in as a test account
(`e2e-bot`) against the **production** database; the PR's own result table says so.
Related facts, measured 2026-10-01: a `bd` row named `ZZ E2E (no asignar)` exists
(role `bd`), and an `e2e_test_account_created` audit row exists (2026-10-01
17:46 UTC; I assume, without checking, that they are the same account). I did not verify
whether the assignee pickers hide it, whether the suite cleans up what it
creates, or how many test rows it has left behind: unverified. No e2e run was
made in this pass.

Update 2026-10-03 (branch `chore/guard-e2e-against-production`): the suite is now
read-only by construction against anything but a local `*_e2e` database.
`tests/e2e/fixtures.ts` aborts and fails any write request to the app,
`tests/e2e/readOnlyGuard.ts` holds the rules, and `playwright.config.ts` starts
its own server on a dedicated port (never reuses one) when writes are allowed.
Classification of the specs, read 2026-10-03: only three tests can write:
`phase7.spec.ts` (duplicate merge, also behind `E2E_ALLOW_DESTRUCTIVE`),
`phase14.spec.ts` (CSV import) and `phase11.spec.ts` (admin conversation audit
row); all three now skip unless the database is a scratch one. Remaining gaps:
(1) `getCurrentBd` (`src/lib/queries.ts:80`) inserts a `bd` row on a first visit,
a plain-GET write the guard cannot see, so a session whose email has no `bd`
row would still create one; (2) `phase11.spec.ts` targets the deleted
`/contacts/[id]/conversation/[bdId]` route and covers nothing, it needs a
rewrite or deletion; (3) the guard has not been exercised at runtime by a
Playwright run (none was possible: no `.env.e2e.local`), only by unit tests,
typecheck and `playwright test --list`: unverified; (4) whether the rows
created by the 2026-10-01 runs were ever cleaned up is still unverified.

Update 2026-10-13. Gap (4) is **answered: the e2e account has no footprint in
production.** Measured read-only against production for
`ZZ E2E (no asignar) <e2e-bot@avalith.net>`: 0 persons with it as
`updated_by_bd_id`, 0 `activity` rows as actor, 0 `task` rows as actor or
assignee, 0 `audit_log` rows, 0 `person_property_history` rows, 0 contacts owned.
Either the runs wrote nothing durable or it was cleaned up; nothing is left.
Gap (3) is now reachable: `bd_contact_intel_e2e` was rebuilt the same day and
matches production (37 tables, the post-0039 FK), with a seed of 9 companies /
38 people / 2 BDs. A Playwright run against it is still outstanding — what HAS
run against it is `npm run test:db` (6 pass), so the scratch database itself is
proven, not the Playwright guard. The old scratch database held 43 person rows
where the seed produces 38; the extra 5 were residue from the 2026-10-01 runs,
which is consistent with those runs writing only to the scratch database.

### task creation writes no activity row
`createTask` and `bulkCreateTasks` write **no** `task_created` activity —
documented deliberately at `src/lib/tasks/bulkCreateDb.ts:20-24` (re-checked on
`main` 2026-10-01; and production holds no `task_created` activity, measured
2026-10-01). Only edit, completion and reopening log an `activity` row naming
the actor (`updateTaskWithActivity`) — in production 2026-10-01: 4
`task_updated` and 1 `task_completed`. Worth recording plainly: the project rule
"every task change logs an activity naming the actor" currently applies to
edit/complete/reopen but not to creation, and that asymmetry is easy to
mistake for a bug later if no one writes down that it's intentional.

### unit-test flake, unattributed
One unreproducible unit-test failure was observed in 1 of 18 consecutive
suite runs on 2026-09-30. It could not be attributed to a specific test name
in 17 further runs — i.e. it has not recurred since, and no failing test name
was identified when it did occur. Not independently reproduced or
investigated further in this pass — **unverified**; for what it is worth,
`npm run test:unit` passed 2317 of 2317 in each of 4 runs on 2026-10-01 (default
zone, `TZ=UTC`, `TZ=America/Argentina/Buenos_Aires`, `TZ=Asia/Tokyo`).

### Open, noted 2026-10-19
- **Edit a contact's first and last name** (owner, 2026-10-19). Some contacts
  show a dash ("—") instead of a name, and the BD cannot fix it from the record:
  first name and last name must be editable (audited like other property edits,
  see person_property_history). Related: the 230 nameless contacts parked for
  joint review (Known defects).

### Open, noted 2026-10-17
- ~~**Phone search**~~ **Shipped 2026-10-18; migration 0051 applied to production the same day (re-checked 2026-10-19: both suffix indexes exist).** Before this the CRM had no phone search:
  `searchCondition` covers only names, company and email, and nothing uses the
  `regexp_replace` digit indexes. Searching should match a local form like
  `11 5555 5555` against stored E.164 `+5491155555555`. (Noted 2026-10-18, after
  the E.164 backfill made stored phones uniform.)
- The e2e login setup times out on a cold dev server (flaky).
- `email_account.reconnect_banner_dismissed_at` is unused. (Checked 2026-10-18:
  only declared, `src/db/schema.ts:1411`, and created/retyped by migrations
  0027 and 0033; nothing in `src/` reads or writes it, and 0 production rows
  have it set.)
- ~~`listAllSequences` has no limit.~~ Fixed 2026-10-18: bounded to the newest 200 whole Sequences plus the viewer's own.
- ~~The role-group backfill has not been run.~~ Wrong as written (checked
  2026-10-18): `scripts/backfill-person-role-groups.ts` has been executed 4
  times (4 `audit_log` rows `backfill_person_role_groups`, last 2026-10-02
  14:12 UTC), and 27,737 of 27,802 persons have a `role_group`; the
  65 nulls all have no job title. Whether the stored groups still
  match today's `classifyPosition` is unverified; the legacy
  `scripts/backfill-role-groups.ts` targets `contact` only.
- ~~There is no lint script, and unused imports are not caught.~~ Fixed 2026-10-18: `npm run lint` (`tsc --noEmit --noUnusedLocals`, no new dependency; not wired into the Vercel build). Unused parameters are not checked.

## Deferred from crm-hubspot-ux

Status re-checked 2026-10-01 against `main`:
- ~~Global cross-object search~~ — **dropped by the owner 2026-10-19:** search
  stays per view (the header search follows the section you are in), on
  purpose. #242 made it context-aware.
- Company pipeline board (`relationshipStage`) — **still not built**
  (`src/app/(app)/companies/page.tsx:47`: "Board/pipeline redesign stays out of
  scope"). The stage itself is now in use: 10 `won` and 3 `proposal_sent`
  companies on 2026-10-01.
- Task queue filters and bulk actions — **owner 2026-10-19: leave as is.** **Partly.** `/tasks` has three view
  tabs, `mine` / `all` / `done` (`src/lib/tasks/viewTabs.ts:12`), and bulk task
  *creation* from the contacts list shipped (#220); there are no bulk actions on
  the task list itself (`tasks/page.tsx` has no bulk control). Whether other
  filters exist was not enumerated: unverified.

## What is NOT a lead-generation path

Recorded because it is easy to plan around wrongly: the discovery and hiring
crons (`/api/hiring/sync`, `/api/hiring/discover`) populate `target_company`
(122 rows, last created 2026-10-01 12:18 UTC) and `job_posting` (7,463) and feed
a review queue — measured 2026-10-01; the previous figures, 88 and 5,259, were
undated. (Both crons are in `vercel.json`: sync daily 09:00, discover Mondays
07:00 UTC.) **They never write a person, contact or lead** — re-checked
2026-10-01: no insert into `person`, `lead` or `contact` anywhere under
`src/lib/hiring` or `src/app/api/hiring`. That is company-level hiring
intelligence, not ingestion.
