# email-sync mockups

Static, clickable-index HTML mockup for the change described in
`openspec/decisions/2026-09-30-email-sync-brief.md`. Nothing here is implemented — no
application code, no `email_message` table, no `/api/gmail/sync` route. It exists so the
owner can approve the UI before slice 5 (timeline rendering, per the brief) is built.

## Open it

`open openspec/changes/email-sync/mockups/email-sync.html` — one file, four stacked
screens/states, with a jump-nav at the top. It reuses
`openspec/changes/crm-hubspot-ux/mockups/styles.css` directly (relative link), so it always
matches the approved design system.

## What's inside

1. **Contact record → "Correos" timeline pill.** Three synced threads on Valentina Rojas'
   ficha: an expanded thread with full bodies, collapsed quoted text, and the exact message
   that fired `reply_received` (badge "Marcó el estado como Respondió"); a collapsed thread
   matched through a deduced email address ("Deducido" badge); and another BD's thread,
   locked with no content, using the same privacy pattern as today's `email_sent`/LinkedIn
   items.
2. **Account → Gmail connection**, three states: needs reconnect (old send-only grant),
   connected + syncing (including an error sub-state), and first sync in progress (90-day
   backfill, with a progress indicator).
3. **Account → "Nunca registrar"**, with items (chip list + add form) and an empty state.
4. **One-time reconnect banner** (optional, per the task), shown above any page while a BD's
   connection doesn't yet include `gmail.readonly`.

## New UI, not yet in the design system

Flagged inline in `email-sync.html`'s `<style>` block and listed as decisions 6–7 below:
a dismissible top banner, a quoted-text collapse toggle inside a thread message, and a
first-sync progress bar. If approved, fold these into
`crm-hubspot-ux/mockups/styles.css` before slice 5 ships.

## Owner decisions needed

The brief (`openspec/decisions/2026-09-30-email-sync-brief.md`) already settled the logging
model, the trigger, body storage, and the 90-day window. These are the choices this mockup
had to make that the brief doesn't cover:

1. **"Deducido" badge reuses `.badge-probable` (amber).** The design system already uses
   that exact class/color for "Probable" email-match confidence in the contacts table and
   board. Using it again for a *different* signal (thread matched via a pattern-inferred
   address, `email_source = 'pattern_inferred'`) means two different meanings share one
   color. Decide: keep the reuse (one less color to learn) or give "Deducido" its own token.
2. **Location of "Nunca registrar."** Mocked as `/account/email/never-log`, a step under the
   Gmail connection page (screen 3), not the general `/account` page. Confirm this is where
   it should live, and whether it needs its own sidebar/breadcrumb entry.
3. **Scope of the never-log list.** Mocked as strictly per-BD self-service (each BD manages
   only their own list, as stated in the brief). Confirm an admin cannot view or edit another
   BD's list — the brief doesn't say either way.
4. **First-sync progress detail.** Mocked with a percentage, a progress bar, and an ETA
   ("36 % · aproximadamente 12 minutos restantes"). The brief only specifies the 90-day
   window and that replies in it move status on first sync — it says nothing about whether
   real-time progress is even knowable server-side (history API doesn't expose a total count
   up front). Decide: keep the detailed progress bar (needs a way to estimate total messages)
   or fall back to an indeterminate "Sincronizando…" spinner with no percentage.
5. **Reconnect banner persistence.** Mocked as dismissible via an × with no reappearance
   logic shown. Decide where "dismissed" is stored (a column on `email_account`, so it
   persists across devices, vs. browser `localStorage`, which is simpler but reappears on a
   new device) and whether closing it counts as declining to reconnect or just "remind me
   later."
6. **New component: dismissible banner.** No banner component exists in the design system
   (only inline `.alert`s inside cards). Built from `.alert` tokens for this mockup. Needs
   owner sign-off before promoting it into `styles.css`.
7. **New interaction: collapsed quoted text.** No precedent for hiding/showing quoted text
   inside a synced message. Built as a plain toggle button + dashed left-border block. HubSpot
   collapses quoted text by default in its email timeline; this mirrors that. Needs owner
   sign-off, and a decision on whether the *first* load is collapsed or expanded by default
   (mocked collapsed).
8. **"Ver en Gmail" link target.** Mocked as `https://mail.google.com/mail/u/0/#all/<thread-id>`
   (thread view, "u/0" = first Google account in the browser session). This only opens the
   right thread if the BD is signed into Gmail as their `u/0` account, which will not always
   be true. Confirm this is an acceptable rough edge for v1, or whether the link should
   instead use `googleapis.com` message permalinks (Gmail doesn't have a stable public one)
   or just omit the account index (`#all/<thread-id>`, letting Gmail pick).
9. **"Deducido" term is new to the glossary.** `GLOSSARY.md` in `crm-hubspot-ux/mockups`
   doesn't list it. Proposing "Deducido" (deduced) as the Spanish term for
   `email_source = 'pattern_inferred'` shown inline on a matched thread; needs to be added to
   the shared glossary if approved, so it stays consistent with the contacts table's existing
   "Probable" usage for the same underlying data (see decision 1 — these may need to converge
   on one word).

## Conventions

Same as `crm-hubspot-ux/mockups/README.md`: the dashed, striped **Mockup note** strips are
not product UI. People are fictional; companies are the same realistic LATAM sample set used
elsewhere. The only script is the inline quoted-text toggle (decision 7).
