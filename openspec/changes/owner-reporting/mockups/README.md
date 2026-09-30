# owner-reporting — mockup

Design-only proposal. No application code changed. Static HTML at
`reports.html`, built on the approved `crm-hubspot-ux` mockups
(`../../crm-hubspot-ux/mockups/styles.css`, same app shell, same components),
plus the two sidebar entries added by later shipped changes (`follow-up-queue`'s
"Seguimientos", `bd-playbook`'s "Guía de roles").

## What the owner is approving

A small set of high-signal cards on one new admin-only page (`/reports`),
answering the four questions `openspec/BACKLOG.md`'s `owner-reporting` item
asks for: discard-reason breakdown, funnel conversion by stage and by source,
activity per BD over time, and follow-up-queue adherence. Deliberately not a
BI tool — one date range, one BD filter, applied to every card at once (with
one flagged exception, decision 7).

Open `reports.html` in a browser. Two cards render their **true current state**,
not invented data:
- **"Descartes por motivo"** is still near-empty — exactly 1 discard exists in
  production as of today, so it renders that count honestly (not a bucketed
  bar, since attributing a single case to one of the 6 reason codes without a
  live read would be guessing) with a collapsed `<details>` "Referencia: así
  se vería con datos (ilustrativo, no real)" underneath, same empty-state
  convention `follow-up-queue.html` used for its own empty/partial states.
- **"Pipeline de empresas"** is the opposite case: `company.relationship_stage`
  was backfilled in #205 (2026-09-29), so this card shows the **real**
  distribution today (Prospecto 13,423 · Calificada 831 · Ganada 2 ·
  Propuesta enviada 0 · Perdida 0, out of 14,256 companies with 0 null) — no
  illustrative reference needed, the real state already demonstrates the
  shape.

Every other card's numbers are illustrative, same as `migration-dry-run.html`.

**Desktop only, by owner direction.** No mobile state was built or
screenshotted.

## Decisions (change any of these — they're the point of this review)

1. **Admin-only, whole page.** The badge (`duplicates.html`'s exact "Solo
   administradores" markup) is a visual affordance only — it does not gate
   anything by itself. Needs a real decision: does `/reports` 404/redirect
   for a non-admin BD (matching `/admin/duplicates` and `/admin/migration`'s
   existing `requireAdmin()` gate), or is it visible read-only to BDs too
   (e.g. so a BD can see their own row in "Actividad por BD")? The mockup
   assumes the former (full admin gate, same as the other two `/admin/*`
   routes) since the backlog frames this as "for the owner," but a BD-visible
   read-only variant is a real, cheap alternative worth naming explicitly.

2. **Default date range: "Este mes."** Alternatives considered: "Esta
   semana" (too short — several BDs' queues wouldn't have enough days to
   look meaningful) and defaulting to no selection at all (rejected — every
   other filtered view in the app defaults to something, not an empty
   state the BD/owner has to configure first). "Este trimestre" was
   rejected as default because it's the least actionable for "what happened
   recently" but is kept as an option for longer trend review.

3. **Discard-reason bar shows only the top 4 of the 6 codes.**
   `.bar-track` ships exactly 4 color classes (`bar-success`/`bar-warn`/
   `bar-info`/`bar-neutral`) — the same 4 `migration-dry-run.html` uses for
   its own 4-way distribution bar. Rather than invent a 5th/6th bar color
   (a new token, explicitly out of scope — "invent nothing new unless
   unavoidable"), the 2 least-frequent codes ("Datos incorrectos", "Otro")
   are listed as plain text under the legend instead of getting their own
   bar segment. Alternative: drop the bar chart entirely for this card and
   use a 6-row table instead (like "Actividad por BD"'s table) — more
   precise, less visual, and consistent across all 6 codes. Flagging for a
   choice since the table alternative has real merit.

4. **Funnel bar colors are the generic bar-track palette, not the
   status-specific badge colors.** Nuevo/Contactado/Respondió/Reunión use
   `bar-neutral`/`bar-info`/`bar-warn`/`bar-success` in that order (coldest
   to warmest), not `--status-new-bg`/`--status-contacted-bg`/etc. — those
   status colors have no `.bar-track` span variant today. The badges shown
   elsewhere on the page (e.g. the "Descartado" badge in this same card,
   the pipeline stage badges in the sibling card) keep their real status
   color; only the bar fill itself uses the generic ramp. Alternative: add
   4 new `.bar-*` classes mapped 1:1 to the status tokens — a small, real
   CSS addition if the owner prefers exact color parity between the badge
   and the bar.

5. **"Reportes" is a new sidebar entry under "Administración",** next to
   Duplicados/Migración — the two other admin-only reads. Alternative
   considered: under "Cuenta" (rejected — this isn't personal settings,
   it's a team-wide report) or as a tab on an existing admin page
   (rejected — Duplicados and Migración are both action queues with a
   queue-clearing outcome; Reportes has no queue to clear, it's a distinct
   kind of screen). New icon (`bar-chart-3`-style, `reports.html:30`) — no
   equivalent existed in the shared icon set; this is the one new visual
   asset this change needs.

6. **"Tasa de respuesta" = contacts with `status = 'replied'` (or further)
   as of period end ÷ contacts with `status = 'contacted'` (or further) as
   of the same period end** — a snapshot ratio, not "of the contacts that
   became Contactado in this period, what fraction later replied" (that
   second definition would need per-contact cohort tracking across periods,
   real work the mockup doesn't assume is already computable). Flagging
   because these two definitions diverge meaningfully once a contact can be
   contacted in one period and reply in the next — the cohort version is
   the more honest "did outreach in period X work" metric, but the snapshot
   version is what's cheap to compute from `person.status` alone.

7. **"Pipeline de empresas" ignores the date-range filter — it's a current
   snapshot, not a period metric,** captioned "Instantánea actual, no
   cambia con el período" on the card itself. `company.relationship_stage`
   is populated for every company today (the #205 default-stage backfill,
   2026-09-29: Prospecto 13,423 · Calificada 831 · Ganada 2 · Propuesta
   enviada 0 · Perdida 0, 14,256 total with 0 null — includes Smart Gen,
   added today directly as Prospecto), but it still has no reliable "when
   did this company first reach stage X" signal, since the backfill set a
   point-in-time value rather than a dated transition. So a period-scoped
   version of this card ("stage changes this period") isn't honestly
   computable from `company.relationship_stage` alone — `company_property_
   history` does log stage changes made through the record page's edit
   control going forward, so that period-scoped card becomes possible once
   real usage accumulates (today: the manual control has produced zero of
   those changes — the whole distribution above is what the backfill left,
   not what a BD moved) — out of scope for this mockup.

8. **Source bucketing:** the backlog names 3 sources (`hubspot_import`,
   `linkedin`, `manual`); `person.sourceKey` actually carries 5 values in
   the DB (`hubspot_import`, `csv`, `manual_create`, `lead_import`,
   `linkedin_import`, plus the partner-account seed's own key). The mockup
   maps `hubspot_import` → **HubSpot**, `csv` + `linkedin_import` →
   **LinkedIn** (both are LinkedIn-derived contact rows, just from different
   import eras), `manual_create` → **Manual**, and buckets everything else
   (`lead_import`, the partner-account seed) into **Otro (eventos, cuentas
   partner)**. Needs owner sign-off — an alternative is a 6-row table with
   every real `sourceKey` value named explicitly, trading a cleaner backlog
   match for a table row per legacy import path.

9. **"Tareas" in Actividad por BD counts tasks completed in the period**
   (`task.status = 'done'`, `updatedAt` in range), not tasks created —
   completed is the more actionable "did the BD close things out" signal
   for a COO review; created tasks are already visible on `/tasks`.
   Flagging since HubSpot's own activity reports usually show "tasks
   completed" too, so this matches the stated baseline, but it's still a
   choice worth confirming explicitly.

## What building it would touch (new DB reads, per card)

None of these exist today; all are new reads. Every one must go through
`PERFORMANCE.md`'s bounded/indexed-query discipline before being built — in
particular, "Actividad por BD" and "Adherencia" both aggregate across BDs and
a date range, so they need `GROUP BY` on an already-indexed column
(`activity.type`/`actor_bd_id`, `follow_up_queue_item.bd_id`), not N+1 per BD.

- **Descartes por motivo** — `count(*) FROM activity WHERE type = 'discarded'
  AND created_at BETWEEN :from AND :to GROUP BY metadata->>'reason'`. Needs a
  new index-friendly path: `metadata->>'reason'` is JSONB, not a column —
  `activity_type_idx` narrows to `type = 'discarded'` first, so the JSONB
  extraction only runs over a handful of rows (today: exactly 1). Computable
  today with existing columns; real total is 1 as of today, not 0 — the
  reason on that one row is real (the discard flow requires one of the 6
  codes on every write) but isn't named in this mockup, since a single
  production row wasn't queried live to confirm which code it is.

- **Embudo de contactos** — `count(*) FROM person WHERE owner_bd_id = :bd
  (or any) AND created_at <= :to GROUP BY status`, using `person_status_idx`.
  Computable today; `person.status` is exactly the cache this needs.

- **Pipeline de empresas** — `count(*) FROM company GROUP BY
  relationship_stage` (no date filter, decision 7). Computable today and
  already backfilled (#205, 2026-09-29) — 0 nulls, real distribution shown
  in the card.

- **Conversión por origen** — same query as the funnel, `GROUP BY
  source_key, status`, `source_key` bucketed per decision 8 in application
  code (not SQL) since the bucketing has no existing column.

- **Actividad por BD** — one query per activity-type bucket (or a single
  `GROUP BY actor_bd_id, type` with `created_at BETWEEN :from AND :to`,
  pivoted in application code) over `activity` for
  note/call/meeting_logged/email_sent/reply_received, using
  `activity_type_idx` + a new need: no existing index covers
  `(actor_bd_id, type, created_at)` together — `activity_created_idx` and
  `activity_type_idx` are separate single-column indexes today. Worth a
  composite index if this ships, per `PERFORMANCE.md`. Tasks completed:
  `count(*) FROM task WHERE assigned_to_bd_id = :bd AND status = 'done' AND
  updated_at BETWEEN :from AND :to` — `task_assignee_status_due_idx` doesn't
  cover `updated_at`, so this is a small new index too. `reply_received` rows
  written by email-sync carry `metadata.source = 'gmail_sync'` — as of
  2026-09-30 this is a real, non-test source (6 contacts moved to Respondió
  from a synced Gmail reply), not just the one self-test email the backlog's
  2026-09-28 inventory recorded.

- **Adherencia a la cola de seguimientos** — `count(*) FROM
  follow_up_queue_item WHERE queue_date BETWEEN :from AND :to GROUP BY
  bd_id, state` for Pospuestos/Omitidos, using `follow_up_queue_item_bd_date_idx`.
  "Trabajados" is harder: per the schema comment on `follow_up_queue_item`,
  a worked row's `state` stays `'pending'` — "worked" is only knowable by
  joining each `state = 'pending'` row's `person_id` against `activity`
  for that same calendar day (`effectiveActivityTime()`, same rule
  `queueSelection.ts` already uses). This is a real new aggregate query, not
  a column read — flag for design review before building, per
  `PERFORMANCE.md`'s "round trips are the budget."

## Placement note

`Reportes` sits in the sidebar's `Administración` section (decision 5). No
existing screen needed to move for this — additive only, same as
`follow-up-queue`'s and `bd-playbook`'s own README notes said about their
respective additions.
