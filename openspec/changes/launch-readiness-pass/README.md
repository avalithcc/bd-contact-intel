# Launch readiness pass

Question asked: with one part-time BD (Mariel) about to lean on this app, what would waste her time or make her distrust the data?

Method: her path was walked as a sequence (filtered list, open the contact, log a call, create a follow-up, back to the list, then the daily Seguimientos queue), against real Supabase Auth and a scratch Postgres database. Nothing here was fixed. Every finding below is recorded as found.

Nothing in this pass touched production. The data layer pointed at `bd_contact_intel_e2e` on local Postgres 16; the guard in `tests/launch-readiness/scratchDbGuard.ts` refuses any non-local host or any database name not ending in `_e2e` (unit test: `tests/unit/scratchDbGuard.test.ts`).

## Bottom line

Mariel's core loop works. Logging a call retires the contact from "Sin contactar", moves the counts, retires the card in Seguimientos and survives refresh, Back and re-filtering.

What would hurt her is not the happy path, it is the first time something goes wrong, and a few places where the screen says one thing and the data says another:

1. A failed save (flaky Wi-Fi, a server error) freezes the dialog, and every other quick action on that page, until she reloads. Whatever she typed is gone.
2. A note with a follow-up task can save the note and lose the task, and the app still says "Nota guardada".
3. In the "Completadas" tab a finished task shows an empty checkbox, and clicking it records a second completion instead of reopening.
4. The order of her "Sin contactar" list is not stable. Any edit to an untouched contact reshuffles the rest.
5. The Seguimientos badge is blank every morning until she opens Seguimientos once.

Severity words used below: **loses data** (something she did is gone or wrong in the database), **misleads** (the screen says something the data does not), **annoys** (works, but costs her time).

## Findings, most serious first

Every finding is reproduced by a spec in `tests/launch-readiness/`. Specs for a confirmed defect are wrapped in `test.fail(...)` so the suite stays green while the defect exists and goes red the day it is fixed. Set `LR_SHOW_FINDINGS=1` to turn that off and see the raw failure.

### F1. A failed save freezes the dialog and every quick action (loses data)

- Did: opened "Llamada", chose an outcome, pressed "Registrar llamada" while the request was aborted (dropped connection), then pressed Escape and re-opened "Llamada".
- Expected: an error message, the form usable again, the typed notes still there.
- Happened: the save never happened, no message, all buttons (including Cancelar) stay disabled. After Escape, re-opening any quick action (call, task, meeting, discard, signal) gives a disabled form. Only a full reload recovers, and the typed text is lost. A 1.1 MB note (server answers HTTP 500, "Maximum array nesting exceeded") ends the same way.
- Code: `src/app/(app)/contacts/[id]/QuickActions.tsx:262-263` (call), `:289-290` (task), `:347-348` (meeting), `:371-372` (discard), `:395-396` (signal), `:323-324` (email). Each does `setBusy(true)`, `await action(...)`, `setBusy(false)` with no `try/finally`, so a thrown action never resets `busy`. `busy` lives in the shared `QuickActions` state (`:134`), and `closeQuickAction` (`:150`) does not reset it, which is why it leaks into every other dialog.
- Reproduces: every time (specs 03: "dropped connection", "Escape closes the dialog", "1.1 MB note").
- Note: normal validation failures (future date) do come back as a readable message; only a thrown action freezes.

### F2. Note plus follow-up task: the task can be lost behind "Nota guardada" (loses data, misleads)

- Did: typed a note, opened "Agregar tarea de seguimiento", typed a title, pressed "Guardar nota", with the second request (the task) failing.
- Expected: either both saved, or a message saying the task was not.
- Happened: the note is saved (1 row), the task is not (0 rows), the composer stays disabled with the note text still in the box. After a reload, pressing save again writes the note a second time.
- Code: `src/app/(app)/contacts/[id]/NoteComposer.tsx:45` calls `addContactTaskAction` and ignores its result, with no `try/finally` before `setBusy(false)` at `:47`. Two separate writes from the browser, not one transaction.
- Reproduces: every time for the thrown path (spec 10). The `{ ok: false }` path (the action returns a failure instead of throwing) is visible in the code at the same line and I could not trigger it naturally, so it is unverified at runtime. It would show "Nota guardada." and no task.

### F3. "Completadas" shows done tasks unchecked, and clicking logs a second completion (misleads, pollutes the audit log)

- Did: completed a task from /tasks, opened the "Completadas" tab, clicked the checkbox on that task.
- Expected: a checked box (it is done); clicking it either reopens or does nothing.
- Happened: the box is unchecked and enabled. Clicking it writes another `task_completed` activity (before=1, after=2 rows) and the task stays `done`. Nothing is reopened.
- Code: `src/app/(app)/tasks/CompleteTaskButton.tsx:24` starts every checkbox as `idle` (unchecked) and `:41` renders `checked={state !== "idle"}`; `src/app/(app)/tasks/page.tsx:300` uses it for done rows too. The server side does not guard either: `setTaskStatusChecked` (`src/lib/tasks/updateWithActivity.ts:156`) writes an activity even when the task already has that status.
- Reproduces: every time (spec 04, "Completadas").
- Reopen does exist and works, but only on the contact record, in the "Tareas" pill ("Reabrir"). It logs `task_completed` then `task_reopened`, both with the actor (verified).

### F4. The "Sin contactar" order is not stable (misleads)

- Did: loaded an untouched cohort in the default sort, edited the job title of the visible contacts through SQL (same effect as any edit from the app), reloaded.
- Expected: same order.
- Happened: the order changed. The default sort is "Última actividad desc nulls last"; for contacts never touched it is NULL for all of them, so the whole list is ties with no tiebreak. Without edits the order is stable across repeated loads and every contact appears exactly once across 4 pages (verified), so the problem only appears when rows change during a long session.
- Code: `src/lib/contacts/listQueries.ts:396-399`. The comment at `:390-395` records that a tiebreak was deliberately not added.
- Impact: while paging a long list after other edits, a contact can be skipped or shown twice.
- Reproduces: every time after edits (spec 02).

### F5. The Seguimientos badge is blank every morning (misleads)

- Did: deleted today's queue rows (what the first visit of a new day looks like), opened /contacts, then /follow-ups.
- Expected: a number next to Seguimientos from the first page of the day.
- Happened: no number on /contacts. On the first visit to /follow-ups (which builds the queue) the page shows 5 cards and the sidebar still shows nothing. The number appears on the next navigation or reload.
- Code: the badge (`src/lib/shell/appShellBadgeCountsQuery.ts:105`) counts only rows that already exist for today's `queue_date`. The queue is built only by `getFollowUpQueuePage` (`src/lib/followUp/queueQueries.ts:164`, called from `src/app/(app)/follow-ups/page.tsx:34`).
- Impact: she has no signal that follow-ups are due unless she goes looking.
- Reproduces: every time (spec 06). After the first visit the badge and the cards agree (spec 05).

### F6. A "Número equivocado" call is queued for a follow-up call a week later (misleads)

- Did: logged a call with outcome "Número equivocado", aged it 10 days in the scratch DB, opened /follow-ups.
- Expected: no reason to call a wrong number again.
- Happened: the contact is in the queue.
- Code: this follows a written owner rule (2026-09-26): any outbound call counts as `contacted` (`src/lib/status/deriveStatus.ts:137-141`, `src/lib/contacts/call.ts` doc on `MANUAL_CALL_DIRECTION`), and the queue takes every `contacted` contact after 7 days (`src/lib/followUp/candidateQuery.ts:81-89`). The side effect on the queue probably was not intended. Needs an owner decision, not necessarily a code fix.
- Reproduces: every time (spec 03).

### F7. No way back to the list she was working except the browser Back button (annoys)

- Did: filtered "Sin contactar" plus "Tiene teléfono", opened a contact, clicked "Contactos" in the sidebar.
- Expected: the same filtered list.
- Happened: bare `/contacts`, all filters and the tab are gone. The breadcrumb on the record is plain text, not a link. Browser Back does restore the filtered list (verified), so this costs her only if she does not use Back.
- Code: sidebar link is a bare `/contacts`; the breadcrumb is a `<span>` in the topbar.
- Reproduces: every time (spec 02).

### F8. Empty-queue button leads to the wrong list (annoys)

- Did: followed the "Ver contactos sin contactar" button target, `/contacts?view=uncontacted`.
- Expected: the "Sin contactar" tab.
- Happened: `uncontacted` is not a view key (the key is `notContacted`); the page falls back to "Todos los contactos".
- Code: `src/app/(app)/follow-ups/page.tsx:77`.
- Reproduces: every time (spec 05). Only visible when the queue is empty.

### F9. Boolean filter chips read "Todos" (misleads)

- Did: applied "Tiene teléfono".
- Expected: a chip that says the filter is on.
- Happened: the chip reads "Tiene teléfono: Todos", which reads as "any", while the list is filtered.
- Code: `src/app/(app)/contacts/FilterMenu.tsx:255` (`chip.valueText ?? l.anyLabel`), `src/lib/contacts/filterChips.ts:85` (`valueText: null` for booleans).
- Reproduces: every time (spec 02).

### F10. Creating a task leaves no activity (misleads)

- Did: created a task from a record.
- Expected: the standing rule says every change logs an activity naming the actor.
- Happened: edits, completion and reopen log one (verified with the actor); creation does not. Who created it is only in `task.actor_bd_id`, which nothing on the record shows.
- Code: `src/app/(app)/tasks/actions.ts:42` (`createTask`, `src/lib/tasks/queries.ts:464`) inserts the task only.
- Reproduces: every time (spec 04).

### F11. Follow-ups made from the note box have no date, and dateless tasks vanish from the record timeline (misleads)

- Did: created a follow-up task from the note box; created a task with no due date from "Tarea".
- Happened: the note-box task always has `due_at = null` (documented in `NoteComposer.tsx`). It does appear on /tasks (verified), but a dateless task never becomes "Hoy" or "Vencidas", so it never nudges her. On the record, the timeline drops it (`upcomingTasks` keeps only dated tasks) and still says "Todavía no hay actividad registrada" while the Tareas count says 1.
- Code: `src/lib/contacts/timelineGrouping.ts:94-99`, `src/app/(app)/contacts/[id]/Timeline.tsx:735`.
- Reproduces: every time (spec 04, spec 10).

### F12. A meeting dated in the future is saved and marks the contact as already met (misleads, minor)

- Did: logged a meeting five days ahead.
- Expected: refused like a call is, or at least not counted as held.
- Happened: saved, status becomes "Reunión" immediately.
- Code: `src/lib/contacts/meeting.ts:31-38` has no future check; the call planner does (`src/lib/contacts/call.ts:117`).
- Reproduces: every time (spec 08).

### F13. A 3,000-character task title makes one /tasks row 888 px tall (annoys)

- The title input has no length limit (`QuickActions.tsx:468`). No sideways scroll, but the row is taller than the screen.
- Reproduces: every time (spec 04). Long call notes (20,000 characters, and 5,000 unbroken characters) do not break the layout.

### F14. "Las asociaciones completas estarán disponibles próximamente." as an empty state (annoys)

- Shown in the Tareas card (`src/app/(app)/contacts/[id]/page.tsx:671`) and the BDs conectados card (`:612`) when they are empty. It reads as unfinished, and in the Tareas card it sits next to a "+" that works.
- Reproduces: every time (spec 04).

## Observations that need an owner decision (not defects I can prove)

- A note alone leaves the contact in "Sin contactar" (status stays `new`) but counts as "worked today" in the queue. She can leave a note on someone and still see them in the "to call" list.
- Creating a follow-up task on a queue card does not retire the card; only call, note, meeting, email or discard do. Verified, probably by design.
- The default list view hides roles: the chip says "Ocultos: Desarrolladores, Ventas y BD (salvo compradores)". With hotel contacts this may hide people she expects to see. I could not check how real hotel contacts are classified.

Code-read only, not exercised: the queue is built once per day and capped at 10 (`FOLLOW_UP_DAILY_CAP`), so after she works the 10 nobody new appears until tomorrow; /tasks reads at most 100 open tasks per view (`src/app/(app)/tasks/page.tsx:145-146`).

## Verified as working

Her path (spec 01, 7 of 7):
- Pick the first contact of "Sin contactar" plus "Tiene teléfono", log "Sin respuesta" with notes: the timeline shows it, the badge moves to Contactado, the database has exactly one outbound call by the right BD.
- Returning by client-side navigation, the contact is gone from "Sin contactar" and the tab count drops by 1. Browser Back does not bring it back. A hard refresh keeps the filter and shows Contactado under "Todos". A just-called contact is not due in Seguimientos.

List integrity (spec 02, 09):
- 160 untouched contacts across 4 pages: each appears exactly once, none skipped; identical order on repeated loads.
- Phone column falls back to mobile when there is no landline.
- Changing a filter on page 3 returns to page 1; a page number past the end is clamped, not blank; removing a chip deep in the list returns results.
- Column choice is saved, survives reload, and is per view.

Calls (spec 03):
- Submit stays disabled until an outcome is chosen; whitespace-only notes are stored as no notes.
- All five outcomes move the contact to the stage the dialog promises.
- Double-click saves one call; leaving the page right after pressing save still saves exactly one.
- A past date is stored at the Argentina time she typed (10:30 ART is 13:30Z); a date with no time is accepted and the timeline shows no made-up hour.
- A future date is refused with a message she can act on, nothing saved, dialog usable again.
- 20,000-character notes are stored whole; no layout break.

Evening clock (spec 08): run at 22:07 ART (UTC already tomorrow), a call with no date is shown as "2 oct, 22:07", and a task due today sits under "Hoy", not "Vencidas".

Queue (spec 05, 06): the queue builds for the day and the badge equals the cards after a reload. Opening "Llamada" from a card opens the dialog by itself. After logging, the card leaves the list and the badge drops with no reload, and this survives refresh and Back. "Posponer a mañana" removes the card and survives reload.

Tasks (spec 04): create (database, record and /tasks agree on title, owner and date); complete from /tasks with an activity naming the actor, visible on the record; complete then reopen (from the record's Tareas pill) logs both with the actor; any BD can complete another BD's task and the activity names who did; editing logs one `task_updated` with the actor; blank and whitespace titles are blocked; a past due date is accepted and shown under "Vencidas"; double-clicking create makes one task; double-clicking the checkbox logs one completion.

Meetings, discards, notes (spec 08, 10): meeting needs a date, saves once on double-click, moves status to Reunión. Discard needs a reason, "Otro" needs a non-blank note, and a discarded contact leaves "Sin contactar". A note saves once on double-click; a whitespace note cannot be saved; note plus task works when nothing fails.

## What I could not exercise, and why

- Production scale and speed. The scratch database holds a few hundred rows; production holds about 26,600 persons and 14,000 companies. Page times, the list queries under load and the role-hiding behaviour with real data are untested. The dev server (`next dev`) is not a production build, so cold starts and Vercel's request limits (about 4.5 MB) are not represented.
- More than one user or tab at once (two BDs, or Mariel in two tabs). Only one session ran.
- Email sending, WhatsApp links, import, AI message generation, Outreach, vacancies/signals and the admin screens. Out of her path.
- The `{ ok: false }` branch of the note composer (F2) and a mid-save navigation on a slow connection (the local server answers in about 0.7 s, so "leave mid-save" saved cleanly every time but the window was tiny).
- Mobile. Desktop only, by decision.
- Gmail-synced activity, `status_backfill` rows and real hotel data. Seed data is synthetic.

## How the pass was run

```
set -a; source .env.e2e.local; set +a            # scratch DATABASE_URL + the e2e bot's credentials
npx tsx scripts/seed-launch-readiness.ts           # dry run
npx tsx scripts/seed-launch-readiness.ts --execute # wipes and reseeds the SCRATCH db only
nohup npx next dev -p 3100 > dev.log 2>&1 &         # background, then poll /login until 200
npx playwright test -c playwright.launch-readiness.config.ts 01- --reporter=line --timeout=45000
# repeat per file: 01, 02, 03, 04, 05, 06, 08, 09, 10
LR_SHOW_FINDINGS=1 ...                             # un-wrap the confirmed defects to see the raw failure
```

Reseed before spec 01: it takes the first contact of the list, and leftovers from earlier runs change which contact that is (this made 01 fail once, and it was the harness, not the app).

Last full run, one file at a time after a reseed: 01 7 passed, 02 7 passed, 03 15 passed, 04 15 passed, 05 7 passed, 06 3 passed, 08 6 passed, 09 5 passed, 10 6 passed. "Passed" includes the specs that confirm a defect (`test.fail`); there are 17 of those, between one and three per defect above (F1 has 3).

Changes to the inherited harness: `reuseExistingServer` is now `true` (a background server on :3100 is reused; the port is dedicated to this pass); `test.fail(true, ...)` became `test.fail(!process.env.LR_SHOW_FINDINGS, ...)`; the 04 reopen spec had a title that collided with the "Reabrir" button matcher and now goes through the Tareas pill; the Completadas spec was rewritten around F3. New specs: 05, 06, 08, 09, 10.
