# follow-up-queue — mockup

Design-only proposal. No application code changed. Static HTML at
`follow-up-queue.html`, built on the approved `crm-hubspot-ux` mockups
(`../../crm-hubspot-ux/mockups/styles.css`, same app shell, same dialogs,
same quick actions).

## What the owner is approving

A per-BD daily follow-up queue: up to 10 of a BD's own contacts, computed
from the rules recorded in
`openspec/decisions/2026-09-30-decision-brief.md` ("Owner decisions",
2026-09-29):

- Due when **Respondió** with 3+ days since the last touch, or
  **Contactado** with 7+ days since the last touch (last touch =
  `effectiveActivityAtSql()`).
- Only the BD's own contacts, last touched within 12 months (older
  contacts stay in Outreach's dormant tier).
- At most 10 per day, **Respondió** first, then within each status the
  most recent last touch first (warmest first).
- The system never sends email; the quick actions only log activity or
  open a Gmail draft.

Open `follow-up-queue.html` in a browser. The top section is the live,
default queue (10 cards, nothing worked yet). Below it, two states that
can't be reached by clicking a static mockup are shown as a reference
gallery, same components, different data: the empty queue, and a
partially-worked queue (3 done, 7 pending). The 390px-wide screenshot is
the same default section, resized — no separate markup, the layout is
already responsive (see `styles.css`'s existing `@media (max-width: 860px)`
rule, same one `contact-record.html` relies on).

## Placement (why a new sidebar entry, not Outreach or Tasks)

**New sidebar entry, "Seguimientos", in "Espacio de trabajo", right below
"Tareas".** Two other candidates were rejected:

- **A tab inside Outreach.** The already-approved `outreach.html` in
  `crm-hubspot-ux` is not a page anymore — it's a redirect notice
  explaining that `/outreach` folded into Contacts' saved views and
  filters. Reviving a stateful daily queue "inside" a page that the design
  explicitly retired would undo that decision and put a live feature
  behind a page whose whole point is "there's nothing here, go to
  Contacts." If the owner wants it there anyway, that's decision **1**
  below.
- **A block on `/tasks`.** `tasks.html`'s own copy says "Toda tarea
  pertenece a un contacto o una empresa" — every row is a real `Task`
  entity with a title, an assignee and a due date created by a BD.
  A follow-up-queue card is not a task: it has no row, no title, no
  explicit due date; it is a live recomputation of contact status and
  last-touch age. Mixing the two would either invent fake task rows for
  every due contact (rejected: it's not what a task means in this app) or
  render two visually different "task-like" things under one heading
  (rejected: exactly the kind of inconsistency the mockup review process
  exists to catch).

A dedicated sidebar entry is the closest match to how HubSpot treats this
behaviorally: a rep's daily work queue is a first-class destination they
check before anything else, not a filtered view of another object and not
buried inside a page already slated for something else.

## Decisions embedded (change any of these — they're the point of this review)

1. **Placement: new sidebar entry, not Outreach or Tasks.** See above.
   Alternative: fold it into Contacts as a seventh saved view ("Vencidos
   para seguimiento"). Rejected here because a saved view is still a
   table row, and this queue's whole value is the compact, action-first
   card layout with the quick actions inline — a table row can't carry six
   quick-action buttons and a "Posponer" menu without becoming unreadable.
2. **The daily 10 are fixed at the start of the day and do NOT refill as
   cards are worked (recommended).** Working a card moves it to
   "Completados hoy" for the rest of the day; the remaining count only
   goes down. Alternative: auto-refill up to 10 whenever a card clears.
   Rejected as the default because (a) it turns a finishable list into a
   moving target — a BD can never see "I'm done for today" — and (b) a
   contact could re-enter the same day's queue minutes after being
   skipped, since nothing else changed except the clock. Needs owner
   sign-off; if the owner prefers auto-refill, only the empty-state
   copy ("no hay seguimientos pendientes ahora mismo, revisá más tarde")
   and the progress bar's semantics change — the cards themselves don't.
3. **"Worked" = any activity logged on that contact today** (note, call,
   meeting, sent email, or discard) via the existing quick actions —
   exactly the set of actions that already change or resolve a contact's
   derived status elsewhere in the app. Opening the record or viewing a
   conversation does not count, matching the existing rule that viewing
   is audited but doesn't change status.
4. **All six existing quick actions are reused unchanged** (Nota, Llamada,
   Correo, Tarea, Reunión, Descartar), deep-linking into the exact dialogs
   already defined in `contact-record.html` (`#log-note`, `#call`,
   `#email`, `#task`, `#meeting`, `#discard`) — no new dialog markup.
   Descartar is included even though the brief's own summary only names
   "note, call, meeting, email draft": dropping it would leave a BD no way
   to close out, from the queue, a contact who plainly isn't going to
   reply, and the previous review round was rejected specifically for
   silently dropping existing functionality.
5. **Two new controls were added, as asked: "Abrir ficha" and a
   "Posponer" menu** ("Posponer a mañana" / "Omitir hoy"). Neither logs an
   activity or requires a reason, unlike Descartar, because neither
   changes the contact's derived status — they only change what the BD
   sees in today's queue. Open question for the owner: should "Omitir
   hoy" require a reason (the way Descartar does), and should a
   postponed/omitted contact still count toward "worked" for the day's
   count, or does it just vanish without being tallied either way? The
   mockup treats it as an untallied, unlogged dismissal.
6. **No owner/responsible chip on each card.** Every other list in
   `crm-hubspot-ux` shows the owner because the table is shared across all
   BDs; this queue is already scoped to "my contacts," so repeating
   "Martín Rivas" ten times added no information. An admin-facing "every
   BD's queue" view is out of scope here and would need the chip back.
7. **Ordering is literal**: Respondió (4 cards: 3, 4, 5, 6 days) before
   Contactado (6 cards: 7, 8, 9, 10, 12, 14 days), ascending days within
   each group. The brief doesn't specify a tie-break for two contacts due
   on the same day count; the mockup doesn't need one at 10 cards, but
   flagging it — recommend company name ascending as a stable, boring
   tie-break.
8. **Empty-state copy links to Contacts' existing "Sin contactar" view**
   instead of leaving the BD stranded, reusing an already-approved saved
   view rather than inventing a new destination.
9. **Progress bar reuses `.bar-track` / `.bar-success` / `.bar-neutral`**,
   the same components `migration-dry-run.html` already uses for a
   distribution bar — no new progress-bar component invented.
10. **The 3-day / 7-day thresholds and the 12-month dormant cutoff are
    only spelled out in the page's intro paragraph**, not restated per
    card. Flag: should each card also show which threshold it crossed
    (e.g., "3+ días" as a small caption), for BDs who don't remember the
    rule from the intro?

## What building it would touch

- A new read: "contacts due for follow-up today, for the current BD,"
  implementing the rule in the decision brief (status + effective
  last-touch age + owner + 12-month recency window), ordered
  Respondió-then-Contactado, most-recent-touch-first, capped at 10. This
  is a new query, not an extension of an existing one — check
  `PERFORMANCE.md` before writing it; it needs to be a single indexed
  query, not N+1 per contact.
- A "today's queue" snapshot mechanism if decision 2 (fixed-for-the-day)
  is approved — something has to remember which 10 contacts a BD saw
  today so the list doesn't silently change if their statuses shift
  mid-day. This is the one piece with real backend design work; the mockup
  intentionally doesn't prescribe a schema for it.
- A "postpone/skip" action (decision 5) that is currently entirely new —
  there's no existing analog to `updateTaskAction` for "hide this contact
  from today's queue." Needs its own server action once schema/semantics
  are decided.
- The sidebar's new "Seguimientos" nav item and its pill count (today's
  remaining pending count for the logged-in BD).
- No changes to `/outreach`, `/tasks`, or the Contacts saved views — this
  is additive.
