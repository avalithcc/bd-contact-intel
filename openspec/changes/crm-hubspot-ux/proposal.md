# Proposal: CRM HubSpot UX and Unified Contact

## Intent

BDs work across two disconnected universes: per-BD LinkedIn `contact` rows (~20k, the same person duplicated once per BD) and team-shared `lead` rows. Nobody can answer "who is this person, who owns them, who has talked to them" from one place, and there is no contact list at all. This change unifies both into one shared Contact per real person and adopts HubSpot CRM UX patterns (list views, three-pane record) with an Avalith-branded, light-only look (`DESIGN.md` tokens, no HubSpot branding).

**Target users**: BDs (daily prospecting and follow-up); admin (the owner) resolving duplicates and supervising conversations.

## Current-State Gap

- Same person exists up to N+1 times (one `contact` per BD + a `lead`); "Also in X's base" papers over it.
- `/contact/[id]` has no list; `/leads/[id]` and `/contact/[id]` are separate single-column pages.
- No roles: `bd` has no role column (verified in `src/db/schema.ts`); every BD has equal permissions.
- No audit trail for merges or for viewing another BD's conversation.

## Scope

### In Scope
1. **Data unification**: single Contact object, reusable identity matcher, merge audit trail, old-id to new-id mapping.
2. **Possible-duplicate review queue** (admin only), with "merge", "not a duplicate", and "unmerge" paths.
3. **Admin role** + **audit logs** (merges, admin views of other BDs' conversations).
4. **Contact record page** `/contacts/[id]`: left About (editable properties, quick actions note/email/task); middle timeline filterable by activity type, designed to also render email threads later; right associations (company, connected BDs). `/leads/[id]` and `/contact/[id]` redirect.
5. **Contact list** (central screen): saved views as tabs, filters, column selection, bulk actions, table/board toggle by status.

### Out of Scope (see `openspec/BACKLOG.md`)
- Email sync, global search, company record page/board, task queue filters/bulk actions.
- Deal/monetary pipelines, marketing sequences, generic any-to-any associations.

## Business Rules

| # | Rule |
|---|------|
| R1 | One Contact per real person, visible and editable by all BDs, with one `owner`. No private copies. |
| R2 | Matching precedence: normalized LinkedIn profile key → auto-merge; exact email with BOTH sides `verified` → auto-merge; normalized name+company → review queue, NEVER auto-merge; otherwise new Contact. Same matcher serves future ingestion. |
| R3 | Owner on merge = BD with earliest `connectedOn`; if no LinkedIn connection, keep the lead's existing owner. |
| R4 | Status pipeline `new → contacted → replied → meeting → discarded` applies to every Contact and is **derived from recorded activity, never edited directly** ("if it is not in the system, it did not happen"): no activity → new; message/email sent → contacted; reply received → replied; meeting logged → meeting; discard logged with a reason → discarded. Status is computed from all activity on the shared Contact, across BDs. |
| R5 | Only admins resolve the review queue. The owner is the first admin. |
| R6 | Admins can always read any BD's conversations; each such view is audit-logged. Non-admins see WHICH BDs have history with a Contact, never the content. |
| R7 | One current value per property with change history ("last updated by X"). On merge: richer/more specific wins, then most recent non-null; losers go to the merge audit trail. Notes append with attribution. `connectedOn` is kept per BD. |
| R8 | Contacts whose company is the own company (Avalith, `src/lib/ownCompany.ts`) remain excluded. |
| R9 | **Mockup gate**: design delivers clickable HTML mockups (list, record, review queue); no UI code is applied until owner approval is recorded. |
| R10 | **Production data gate**: every migration/merge runs first as a dry-run report (auto-merged / flagged / new + per-table counts), reviewed by the owner before executing on production. |
| R11 | **UI is Spanish only**: no language switcher, no English UI path. All user-facing copy is neutral, professional Spanish, sourced from a single centralized `es` dictionary, with terms kept consistent per `mockups/GLOSSARY.md`. English can be added later, but is out of scope now. |

## Capabilities

### New Capabilities
- `contact-identity`: unified Contact model, matcher precedence, property conflict and history rules.
- `contact-migration`: collapse/fold backfill, id mapping, dry-run report gate.
- `duplicate-review`: admin queue, merge / not-a-duplicate / unmerge.
- `admin-access-audit`: admin role, conversation visibility rules, audit logs.
- `contact-record`: three-pane record page, quick actions, filtered timeline, associations, redirects.
- `contact-list`: saved views, filters, columns, bulk actions, table/board.

### Modified Capabilities
- None (no specs exist yet under `openspec/specs/`).

## Approach

Record-first vertical slicing from exploration ("extract, don't predict"):

| Slice | Content | Gate |
|---|---|---|
| 0 | Admin role, audit tables, matcher; collapse `contact` duplicates by profile key; connected-BDs + per-BD `connectedOn` | Dry-run report |
| 0b | Fold `lead` rows via matcher; re-point `activity`/`task`/`signal`/`linkedinScrapeJob`; repoint outreach/hiring reads at unified Contacts without per-BD scoping | Dry-run report |
| 1 | Duplicate review queue | Mockup approval |
| 2 | `/contacts/[id]` record page + redirects | Mockup approval |
| 3 | Contact list with views/board | Mockup approval |

## Implications and Impact

- **No per-BD contact universe (owner decision).** There is no "my contacts" or "my contacts I haven't contacted" base anymore: there are only Contacts. What today are per-BD outreach lists become **filters and saved views over the single contact list** (e.g. owner = me, status = new, has verified email, company is hiring). Outreach and hiring reads stop scoping by `bdId`; per-contact actions (AI message generation) stay available on the record and list. The expected change in outreach results is intentional, not a regression, so no parity check is required.
- **Conversation privacy**: message reads must stay scoped by `bdId` even though the Contact is shared; only the admin path bypasses it, with an audit entry.
- **Board** now acts on all Contacts, including LinkedIn-only ones (volume jumps from leads to ~all people). Dragging a card does not set status directly: it opens the matching log action (e.g. dragging to `meeting` opens "Log meeting"; to `discarded` asks for a reason), and status changes because the activity was recorded.
- **Reviewer workload**: name+company matches, and later scraped/purchased data, land in the admin queue.

## Edge Cases

- Person is a LinkedIn contact of 3 BDs and also a lead → one Contact; owner = earliest connector; 3 connected BDs with own dates; lead notes/status/source preserved.
- Lead without email and LinkedIn → only name+company matching possible → review queue or new Contact.
- Admin merges a false match → "unmerge" restores both records from the merge audit trail; "not a duplicate" suppresses the pair from resurfacing.
- Existing leads with a manually set status and no supporting activity (e.g. `meeting` set by hand) → the migration writes a backfilled activity ("status recorded before migration", with the original editor and timestamp) so the derived status is preserved with evidence instead of being reset.
- Multiple BDs with different activity on the same person → status is derived from the combined activity of the shared Contact, so the most advanced recorded stage wins.
- Own-company person connected to BDs → stays excluded after merge.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| False auto-merge corrupts data | Low | Strong keys only; name never auto-merges; unmerge path; dry-run |
| Outreach/hiring lists change shape | High (intended) | Replaced by explicit saved views on the contact list; owner validates views in the mockups |
| Conversation content leaks across BDs | Med | BD-scoped reads by default; admin bypass audited |
| Migration exceeds 400-line PR budget | High | Sliced delivery (ask-on-risk) |
| Uncommitted dark-mode removal in working tree | Med | Commit or discard before UI slices |

## Rollback Plan

- Migration slices are additive first: new Contact tables + id mapping written alongside legacy `contact`/`lead`, which stay read-only until verification. Rollback = point reads back to legacy tables and drop new rows.
- Production backup snapshot taken before each non-dry-run execution.
- UI slices: redirects and new routes revert via git; legacy pages remain until slice 2 is accepted.

## Dependencies

- Owner availability for dry-run review and mockup approval.
- Dark-mode removal committed before UI work.

## Success Criteria

- [ ] Zero Contacts sharing a normalized LinkedIn profile key or a verified email.
- [ ] 100% of legacy `contact` and `lead` ids resolve to a Contact via the mapping table.
- [ ] Every Contact reachable from the contact list; `/leads/[id]` and `/contact/[id]` redirect.
- [ ] Zero orphaned `activity`/`task`/`signal`/`linkedinScrapeJob` references.
- [ ] No query scopes Contacts by `bdId`; former per-BD outreach lists are reproducible as saved views (owner, status, email, hiring company).
- [ ] 100% of admin views of other BDs' conversations produce an audit entry; non-admins cannot read them.
- [ ] Owner approval recorded for mockups and each dry-run before execution.

## Resolved Questions

- Unmerge is admin-only and available at any time, restored from the merge audit trail (no time window).
- Status is derived from recorded activity; there is no manual status override (see R4).
- There is no per-BD contact universe; former per-BD lists become saved views (see Implications).

No open questions remain.
