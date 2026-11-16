# admin-role-group-visibility — mockup

Design-only proposal. No application code changed. Static HTML at
`reportes-roles-excluidos.html`, generated from the already-approved
`owner-reporting/mockups/reports.html` with **one column added**. Nothing
else on that screen changes.

Open it in a browser and look at the last card, "Adherencia a la cola de
seguimientos".

## Why this exists

`follow-up-role-groups` (merged, PR #443 + #444) lets each BD keep chosen
role groups out of their own daily follow-up queue. The queue is per-BD:
`/follow-ups` reads `getFollowUpQueuePage(me.id, now)` with no `bdId` and
no filters, and `saveFollowUpRoleGroupsAction` takes no `bdId` — it writes
`getCurrentBd().id`. So an admin has no way to see what any other BD
excluded.

That matters for a report the owner already reads. The adherence card
scores each BD on the queue they were given. **A BD who excludes groups is
working a different queue, not the same queue harder** — so the percentage
stops being comparable between BDs, and across time for the same BD, the
moment anyone configures a preference. The exclusions belong next to the
number they qualify.

## Decisions to approve

### 1. Read-only (owner decision)

The admin **sees** each BD's excluded groups and cannot change them. The
preference stays the BD's own.

The rejected alternative was an editable admin control modelled on
`/admin/lusha` (one switch per BD over a `bd` column, with "changed by /
changed at" attribution). That would turn the feature from "my preference"
into "a policy that can be imposed on me", which would in turn require
recording who changed it. Not what was asked for.

Because it is read-only, it writes no `audit_log` row — consistent with
this repo's rule that audit_log is for consequential actions, and that
admin visibility is never audited.

### 2. A column in the existing card, not a new admin page

No new sidebar entry, no new screen. The information is only useful
pressed against the adherence number, so it goes in that table.

### 3. Cell format

Up to two group labels as `badge-outline no-dot`, then `+N` for the rest,
with the full list in the cell's `title` on hover. A BD with no exclusions
shows `—`, and so does the Total row, where a sum would be meaningless.

All three states are visible in the mockup: no exclusions, two plus
overflow, and a single one.

## What it costs

One extra value per BD row. `bd.follow_up_excluded_role_groups` is a
column on `bd`, and the report already joins `bd` for the name and avatar,
so this should add no round trip — to be confirmed against the real query
during implementation rather than assumed.

**Desktop only, by owner direction.**
