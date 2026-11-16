# follow-up-role-groups — mockup

Design-only proposal. No application code changed. Static HTML at
`follow-up-roles.html`, built on the approved `crm-hubspot-ux` mockups
(`../../crm-hubspot-ux/mockups/styles.css`, same app shell) and on the
approved `follow-up-queue` mockup (same cards, same quick actions, same
"Posponer" menu).

Open `follow-up-roles.html` in a browser. The panel "Roles a seguir" is
shown open, with `Desarrolladores`, `Ventas y BD` and `Sin cargo`
unchecked. Below the live queue there is a reference gallery: the same day
with the preference off, where 4 of the 10 slots go to those groups.

## The problem this solves

The owner asked for "a filter like the one in Contactos" on Seguimientos.
A view filter is the wrong tool there, and the reason is in the code:

- **Contactos** filters a *view* over the whole base
  (`src/app/(app)/contacts/FilterMenu.tsx` over `person.role_group`,
  a stored and indexed column — `src/db/schema.ts:71`). Filter, and the
  query returns different contacts.
- **Seguimientos** is not a list, it is a **materialized daily queue**.
  `FOLLOW_UP_DAILY_CAP = 10` (`src/lib/followUp/queueSelection.ts:33`).
  At most 10 new contacts enter per Argentina calendar day, chosen in SQL
  by `(fuq_status = 'replied') desc, fuq_last_touch desc,
  fuq_company_name asc` (`src/lib/followUp/candidateQuery.ts:185`).

`role_group` does not appear anywhere in `src/lib/followUp/`. The queue is
blind to it. So a view filter would hide developers *after* the 10 slots
were already spent on them: the BD would see 6 cards, not 6 cards plus 4
replacements. The slots are gone before the page renders.

Worse, the BD playbook already shipped in production marks
`developers` and `sales_bd` as **"No priorizar"**
(`src/lib/roleGroupPlaybook.ts`), and the queue keeps spending slots on
them anyway. The guide we shipped and the queue we shipped disagree.

## Decisions to approve

### 1. It filters the SELECTION, not the view

The preference is applied in `candidateQuery.ts`'s `WHERE`, so the cap of
10 fills with roles the BD actually wants. Not a chip on a toolbar.

Trade-off: the control is less discoverable than a filter chip, and its
effect is not instant (see decision 3). In exchange it actually protects
the day instead of hiding it.

### 2. Stored per BD, as a deny-list, defaulting to today's behavior

A new column on `bd`, next to `signature_html` and
`email_reminders_enabled` (the existing convention for a per-BD
preference — `src/db/schema.ts:21-51`):

```
follow_up_excluded_role_groups text[] not null default '{}'
```

- **Empty array = exactly today's behavior.** Nothing changes for any BD
  until that BD opts in. No migration backfill, no silent behavior change.
- **Deny-list, not allow-list, on purpose.** If a new `RoleGroupKey` is
  added later (`src/lib/roleGroups.ts`), an allow-list would silently
  exclude it for every BD who had saved a list. A deny-list includes it by
  default, which is the safe direction.
- **At least one group must stay included.** "Guardar" is disabled when
  every group is unchecked; an empty queue by configuration is a support
  ticket, not a feature.

The owner may prefer a different default: pre-exclude the two
`no_priorizar` groups for everyone. **Not proposed here** — that changes
what every BD sees tomorrow without them asking. Flagged as the owner's
call.

### 3. It applies to who ENTERS, never to who is already in the queue

Saving affects the next daily build. Rows already materialized for today
stay on the page until the BD works them, drops them, or they expire.
The warning banner in the mockup says exactly this.

Why not evict in-flight rows: `openCycleRowSql`
(`src/lib/followUp/openCycle.ts`) is, by its own doc comment, "the ONE
definition, in SQL, of a follow-up item that is still open", shared by the
page read, the cap computation, the new-entry exclusion, the sidebar badge
and the expiry job. Adding the preference there would make items vanish
mid-cycle with no activity row and no audit trail, and re-checking the
group would resurrect them as if nothing happened. The existing "Descartar
seguimiento" button already handles "get this one out of my queue", and it
logs a reason.

### 4. The panel shows the playbook priority and a due count per group

Each row carries the group's priority badge from `ROLE_GROUP_PLAYBOOK` and
the BD's own count of contacts currently due in that group, so excluding a
group is an informed decision rather than a guess. This is what finally
connects the playbook to the queue.

Cost, and the change made because of it: the counts query was measured
with EXPLAIN ANALYZE against production at 99 ms (12,413 owned contacts),
86 ms (5,163) and 73 ms (51). The cost does not follow the BD's contact
count: it is a fixed floor from the full scans of `activity` (9,231 rows,
8,635 seq-scanned in `fuq_activity`) and `person_bd_connection` (5,389),
and it grows with `activity`. Paying it on every `/follow-ups` load for a
number read rarely was rejected, so **the counts are lazy-loaded when the
panel is opened** (one server action per open, a skeleton in the count
column meanwhile; checkboxes, labels and badges render and save without
them). The "N contactos vencidos quedan fuera de la rotación" meta moved
into the panel for the same reason; the chips and the "Aplica desde
mañana" banner stay on the page because they only need the saved array.

### 5. Optional — show the role group on the queue card

The mockup shows a `badge-outline` with the group name on each card. It
answers "why is this person in my queue today". Strictly optional; say the
word and it comes out.

## Placement

Page header of `/follow-ups`, as a `btn-secondary` dropdown — the same
`details.dropdown` + `.check` + `.menu-footer` pattern as the approved
column picker in `contacts-filter-menu.html`. No new component was
invented and no new color was added.

It is NOT mirrored in `/account`: one control, one place. The pain is felt
on Seguimientos, so the fix lives on Seguimientos.

**Desktop only, by owner direction.** No mobile state was built.

## Correction after implementation (2026-11-16)

The trigger badge in the first version of this mockup used `.pill-count`,
which is nested-only CSS (`.nav-item .pill-count`, mockup `styles.css:234`
and `src/app/design-system.css:126`) and would have rendered unstyled on a
`summary.btn`. Corrected here to `badge badge-neutral no-dot` — existing
classes, no new CSS — so this file and the implementation agree.
