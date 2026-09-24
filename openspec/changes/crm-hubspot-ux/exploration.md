# Exploration: crm-hubspot-ux

Adopt HubSpot CRM UX patterns across bd-contact-intel with a modern, light, Avalith-branded visual layer (not HubSpot branding), and unify contacts and leads into a single shared Contact object.

## Owner decisions (fixed inputs)

1. Adopt HubSpot **UX patterns** (views, record pages, lists, pipelines, activity logging, tasks, associations). Do not copy HubSpot's visual identity; the look should be modern, clean, light-only.
2. `contact` and `lead` are **unified** into one Contact object.
3. Visibility follows HubSpot: **one shared, team-wide record per person with an owner property**. No per-BD private copies.
4. Identity is matched on **LinkedIn profile, email and name (+company)**.
5. **No duplicates**: one record per real person. The "also in X's base" overlap feature is retired (at most replaced by "BDs connected to this person").

## Current state

### Routes

| Route | Purpose | Object | Shape |
|---|---|---|---|
| `/leads` | Lead list + board toggle | `lead` | Table + kanban by status (dnd-kit) |
| `/leads/[id]` | Lead record | `lead` | Single column: header, timeline, email composer, quick add |
| `/contact/[id]` | Contact record | `contact` | Single column; **no contact list page exists** |
| `/companies`, `/companies/[key]`, `/companies/new` | Company list / record / create | `company` | Cards list, single-column record, form |
| `/tasks` | Task queue | `task` | Cards grouped overdue/open, no filters |
| `/outreach` | Ranked outreach candidates + AI message | `contact` (derived) | Filtered list |
| `/hiring`, `/whats-new`, `/discovery` | Hiring-signal surfaces | `targetCompany`, `jobPosting`, `boardCandidate` | Lists/digests/review queue |
| `/account`, `/account/email`, `/account/password`, `/login` | Settings and auth | `bd`, `emailAccount` | Forms |

### Domain model (`src/db/schema.ts`)

- `contact`: per-BD, unique `(bd_id, profile_key)`, LinkedIn-derived, message aggregates. ~20,389 rows.
- `lead`: team-shared, unique `(source_key, attendee_id)`, `ownerBdId`, status pipeline `new|contacted|replied|meeting|discarded`, notes.
- `company`: team-shared, keyed by `companyKey`, `relationshipStage` (prospect → won/lost). Separate from `targetCompany` (hiring-signal graph) though they share key derivation.
- `activity`, `task`, `signal`: polymorphic subject — exactly one of `leadId` / `companyKey` / `contactId` (app-enforced, no DB CHECK).
- `conversation` / `message`: per-BD LinkedIn DMs, joined to contacts by `peerProfileKey` (no FK). Message content must always be read scoped by `bdId`.
- Others: `emailAccount`, `linkedinScrapeJob`, `lead_source`, discovery/ATS tables.

Associations are implicit (nullable FK triplets and `companyKey` conventions). There is no association table and no cross-object "associated records" query.

### Shell, styling, i18n

- `layout.tsx` + static `Sidebar.tsx` (CENTRAL: Leads, Companies, Tasks, Outreach; AREAS: Hiring, What's New, Discovery). No global header, search, breadcrumbs or quick-create.
- The three record pages duplicate the same markup (not-found block, header/badge, field rows, quick-add layout).
- A token system already exists: `globals.css` tokens documented in `DESIGN.md` (light-only, Avalith red `#d5252f` accent). Hardcoded hex is limited to status/stage badge maps in `companies/[key]/page.tsx` and `leads/[id]/page.tsx` (14 literals).
- i18n (`t(locale)` dictionaries) is applied in `/leads`, `/outreach`, `/hiring`; record pages, `/companies` and `/tasks` hardcode English and use emoji as icons.
- Uncommitted working-tree changes remove dark mode (`src/lib/theme/*`, theme switcher). Not to be depended on until committed.

## HubSpot UX patterns

- **Index views**: saved view tabs, filters, column selection, bulk select + bulk actions, table/board toggle for pipeline objects.
- **Record page** (three panes): left "About" with editable property cards and quick actions (note, email, call, task, meeting); middle tabs (Activity timeline, Overview); right associated-record previews. Source: https://knowledge.hubspot.com/records/work-with-records
- **Activity timeline**: unified chronological feed filterable by activity type.
- **Pipelines**: kanban by stage, drag to change stage, per-stage counts.
- **Tasks queue**: due-date grouping, filters by owner/type, inline complete; tasks are always associated with a record.
- **Associations**: linked records shown in the right sidebar with add/remove.
- **Global search** and a top bar with quick-create.

## Mapping and gaps

| HubSpot pattern | Our surface | Current state | Gap |
|---|---|---|---|
| Three-pane record page | contact, lead, company records | Single column, duplicated 3x | L |
| Header quick actions | lead record | Composer, task and signal blocks stacked below content | M |
| Timeline with type filter | `ActivityTimeline` | Flat, unfiltered | M |
| Associations sidebar | none | No UI, no query | L |
| Saved views, columns, bulk actions | `/leads`, `/companies` | Query-string filters only | L |
| Table/board toggle | `/leads` has it | Missing on companies; contacts have no list | M–L |
| Pipeline board | `/leads` | Works; companies' stage has no board | S (leads) / M (companies) |
| Tasks queue | `/tasks` | Close already; no filters | S |
| Global search | none | Missing | L |
| Contact/lead unification | contact + lead | Two universes | L (prerequisite) |

**Patterns that do not fit**: monetary deal pipelines and forecasting (no deal object; `company.relationshipStage` is a light enum), marketing sequences/workflows, consent/subscription cards, playbooks, Salesforce sync, and a generic any-to-any association framework (scope associations to real pairs: contact↔company).

## Unification analysis

### Schema comparison

- Shared concepts: name; company (contact free text vs lead `companyRaw` / `companyDisplay` / `companyGroup`, richer on lead); industry; role (contact `position` / `roleGroup` vs lead `jobTitle` / `seniority`, different taxonomies); email verification (`emailStatus` / `emailConfidence` / `emailSource`, same vocabulary on both).
- Contact-only: `profileKey`, `connectedOn`, LinkedIn message aggregates, `initiatedByMe`, `reciprocal`.
- Lead-only: status pipeline, `ownerBdId`, `updatedByBdId`, notes, geography, `attendeeType`, source provenance (`lead_source` stays as a source lookup).

### References to migrate

- `activity`, `task`, `signal`: collapse `contactId` / `leadId` into one Contact reference.
- `linkedinScrapeJob.contactId`: re-point.
- `conversation.peerProfileKey`: keep `profileKey` queryable on the unified Contact so the join keeps working.
- `overlapByProfileKey` ("also in X's base"): retired, replaced by "BDs connected to this person".
- `outreach` and hiring queries read `contact` scoped by `bdId`: must be re-scoped from row ownership to the BD's own activity (e.g. "contacts I haven't messaged" becomes an activity query). Risk: silently changing ranking.

### Visibility

One row per person, nullable `ownerBdId`, readable and writable by all BDs. LinkedIn message **content** stays scoped by `bdId` at the conversation level even though the Contact is shared.

### Match precedence

1. Normalized LinkedIn profile key match → auto-merge (near-zero false positives).
2. Exact email match where both sides are `verified` → auto-merge. `probable` / pattern-guessed emails are not safe for auto-merge.
3. Normalized name + company match → **possible-duplicate review queue**, never auto-merge. Common LATAM names inside large employers make false merges likely, and a false merge is far harder to detect and undo than a duplicate.
4. Otherwise → new Contact.

Implication for future ingestion (scraping, purchased databases): those rows usually lack a LinkedIn URL and a verified email, so most will land in the review path. This is deliberate, and it creates reviewer workload that future ingestion features must size for.

### Per-BD data on merge

- LinkedIn conversations/messages: re-pointed, not merged; each BD's history stays intact and BD-scoped.
- `connectedOn`: kept per BD as a list, not collapsed into one value.
- Notes: appended with attribution, never overwritten.
- Other property conflicts: richer/more specific value wins, then most recent non-null; losing values go to a merge audit trail.

### Backfill plan

1. Collapse `contact` duplicates by `profileKey` (drop `bdId` from identity); derive "connected BDs" and per-BD `connectedOn`.
2. Re-point conversation continuity via the surviving `profileKey`.
3. Fold `lead` rows in with the strong-key matcher; unmatched leads become new Contacts carrying source provenance and `ownerBdId`; weak matches go to review.
4. Migrate `activity` / `task` / `signal` / `linkedinScrapeJob` references through an old-id → new-id mapping table.
5. Apply property conflict rules.

Steps 1 and 3 must run first as a **dry-run report** (auto-merged, flagged for review, new) reviewed by the owner before touching production data.

## Execution approaches

1. **Design-system-first**: build shared primitives (record shell, index shell, activity log bar), then migrate each route. Consistent result; no visible value early; risk of predicting the wrong abstraction.
2. **Record-page-first vertical slice** (recommended): build the full pattern for one object, ship it, then extract shared pieces when a second object validates them ("extract, don't predict").
3. **Full shell rewrite in one pass**: no inconsistency window; guaranteed oversized diff, high risk, conflicts with `ask-on-risk`.

### Recommended slice order

- **Slice 0**: collapse `contact` duplicates in place with the matcher + merge audit trail, validated through the dry-run report.
- **Slice 0b**: fold `lead` rows in with the validated matcher.
- **Slice 1**: unified Contact record page at `/contacts/[id]` (three panes, quick actions, filtered timeline, company association); `/leads/[id]` and `/contact/[id]` become redirects.
- Later: index views, company record and board, global search, tasks filters.

## Risks

- Unification is a real data migration across 5+ tables and will exceed a 400-line PR if not sliced.
- Name-based matching must never auto-merge.
- Re-scoping outreach/hiring queries can silently change behavior.
- Dark-mode removal is still uncommitted.

## Open product questions (for the proposal round)

1. Ownership on merge: when several BDs had the same person, who becomes the owner?
2. Conflicting properties after merge: single current value with history, or visible per-field provenance ("last updated by X")?
3. Message privacy: should the record show "N other BDs have message history with this person" without showing content?
4. Is the status pipeline (`new → contacted → replied → meeting → discarded`) universal for every Contact, including LinkedIn-only ones?
5. Who resolves the possible-duplicate review queue: each BD for their own contacts, or one admin?
6. Which is the primary working record: Contact, or Company with contacts underneath?
7. What is `company.relationshipStage` for: a real pipeline with a board, or just a label?
8. Priority of global search and saved views relative to the record page.
