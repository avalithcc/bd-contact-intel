# admin-conversation-access mockups

Static, clickable-index HTML mockup for `admin-email-conversation-access`
(`openspec/BACKLOG.md`). Nothing here is implemented — no new components, no new routes.
The backend already exists (`src/lib/activity/getConversationForAdmin.ts`,
`src/lib/activity/conversationAudit.ts`, the `audit_log` table, and the route
`src/app/(app)/contacts/[id]/conversation/[bdId]/page.tsx`); this mockup designs the
**UI entry point** that got dropped when the old LinkedIn surfaces were hidden.

## Open it

`open openspec/changes/admin-conversation-access/mockups/admin-conversation.html` — one
file, three stacked screens, with a jump-nav at the top. It reuses
`openspec/changes/crm-hubspot-ux/mockups/styles.css` directly (relative link) and the
locked-thread pattern from `openspec/changes/email-sync/mockups/email-sync.html`, so it
matches both approved design systems.

## What's inside

1. **Contact record (admin view), locked thread rows.** Same "Correos" timeline as
   `email-sync.html` screen 1, but seen by an admin: every locked thread (synced email or
   legacy LinkedIn) that belongs to another BD gets a new **"Ver conversación (queda
   registrado)"** action. Clicking it opens a confirmation dialog (reusing the
   `duplicates.html` "¿Deshacer la fusión?" modal pattern) that states the view is
   audited and visible ONLY to administrators (owner decision, 2026-09-30 — the
   conversation's owner is never notified and has no way to see it), then goes to
   screen 2. The
   right-rail "Historial de conversaciones" card (already in `contact-record-admin.html`)
   keeps its own "Ver" link per BD, pointing at the same destination.
2. **Conversation view (admin only).** The dedicated page — mocked twice: once for Juan
   Martínez (synced email thread + legacy LinkedIn thread, both with content) and once
   for Ana Pereyra (synced email only, LinkedIn section shows the standard `.empty`
   state). Top banner: "Estás viendo la conversación de &lt;BD&gt; como administrador —
   este acceso quedó registrado", built from the existing `.alert-audit` token, no new
   banner component. Sections are grouped by source ("Correos sincronizados",
   "Conversación de LinkedIn"), reusing the `.thread`/`.thread-msg` components from
   `email-sync.html` and `contact-record.html` respectively.
3. **Administración → Registro de auditoría.** A new sidenav item under the existing
   "Administración" section, next to Duplicados and Migración. One table, minimal: who
   viewed whose conversation, about whom, and when — one row per `audit_log` entry where
   `action = 'view_conversation'`. Each row's "Abrir" re-opens that conversation (same
   route, no re-confirmation — the admin already has the audit trail open).

## Owner decisions

<a id="decision-1"></a>
1. **RESOLVED (2026-09-30): the BD is not notified.** The owner decided viewing
   another BD's conversation must stay silent — no email, no in-app toast, no Slack,
   no batching into the digest. The confirmation dialog and the audit banner were
   updated to drop the old "Juan/Ana va a poder ver que la visualizaste" line; they now
   only state that the view is recorded in the admin-only audit log.
2. **RESOLVED (2026-09-30): there is no BD-visible surface, by design.** The original
   draft of this mockup promised a BD-facing trace ("Juan va a poder ver...") that no
   screen actually backed. The owner's decision removes the promise instead of building
   the screen: `audit_log` stays admin-only, visible only through screen 3 (Registro de
   auditoría). A BD has no UI path, today or planned, to see that an admin viewed their
   conversation.
3. **RESOLVED (2026-09-30): keep both entry points.** Screen 1 shows the new button on *every* locked
   row (2 rows for Juan Martínez: one email thread, one LinkedIn conversation), plus a
   third "Ver" link in the right-rail "Historial de conversaciones" card for the same
   BD. All three navigate to the same combined conversation page. Confirm this
   duplication is acceptable (each is contextual: click from wherever you're looking)
   or whether the per-row action should be dropped in favor of the single right-rail
   entry point, to avoid a wall of identical buttons on contacts with many locked rows.
4. **RESOLVED (2026-09-30): (contact, BD)-scoped, matching the existing route.** Related to (3): the route is
   `/contacts/[id]/conversation/[bdId]` — scoped to (contact, BD), not to an individual
   thread. So two locked rows for the same BD always link to the same page, which then
   shows *all* of that BD's content with this contact (both channels), not just the
   thread that was clicked. Confirm this is the intended granularity (matches the
   existing route/`getConversationForAdmin` signature) rather than a thread-scoped view.
5. **RESOLVED (2026-09-30): scoped to `view_conversation` only, for now.** Mocked as `view_conversation` entries only.
   `audit_log.action` also covers `merge`, `unmerge`, `not_duplicate`,
   `migration_approve`, `migration_execute`, `bd_password_reset` — and merges already
   have their own history table (`duplicates.html#history`). Decide whether "Registro de
   auditoría" should stay scoped to conversation views (this mockup) or become a general
   audit log that supersedes/links to the merge history table too.
6. **RESOLVED (2026-09-30): accepted, folded into `styles.css`.** No existing `.locked` usage (today's
   LinkedIn/`email_sent` privacy rule, or the email-sync mockup) puts an interactive
   control inside the block — it has always been read-only chrome for non-admins. This
   mockup adds `.locked-actions` (flagged inline in the `<style>` block) as a thin
   wrapper so the button sits visually inside the locked card without changing
   `.locked`'s own layout. Needs sign-off before folding into `styles.css`.
7. **RESOLVED (2026-09-30): no retention limit — show everything, paginated.** Mocked as
   "últimos 90 días" (matching the email-sync backfill window, for visual consistency
   only — there's no other reason to couple them). The real page drops the 90-day scope
   entirely and paginates the full history instead.
8. **RESOLVED: reuse the existing dictionary copy.** The task text says `"Ver conversación (queda registrado)"`; the
   existing dictionary entry for the conversation page banner
   (`src/lib/i18n/dictionaries/es.ts` → `adminConversation.auditNotice`) instead reads
   "Esta visualización queda registrada en el registro de auditoría." This mockup uses
   the shorter task wording for the button/action (it's a label, not a sentence) and the
   longer established phrasing for the full-sentence banner and dialog body, to avoid
   inventing a third variant. Confirm both are acceptable side by side, or pick one
   register for all admin-audit copy.

## Known implementation gap (not a design decision, flagging for the apply phase)

`getConversationForAdmin` already returns `syncedEmails` (Gmail-synced messages,
`email-sync` change) alongside `emailEntries` (legacy manual `email_sent` activities)
and `linkedin`. The current page
(`src/app/(app)/contacts/[id]/conversation/[bdId]/page.tsx`) only renders
`emailEntries` and `linkedin` — it never reads `syncedEmails`. Screen 2 of this mockup
("Correos sincronizados") assumes that gap is closed; building this entry point without
also wiring up `syncedEmails` would ship a page that silently drops the exact content
(Gmail threads) the backlog item is about.

## New UI, not yet in the design system

Flagged inline in `admin-conversation.html`'s `<style>` block and listed as decision 6
above: `.locked-actions`, a thin action row inside `.locked`. Everything else (dialog,
`.alert-audit` banner, `table.data`, `.thread`/`.thread-msg`, `.empty`) is existing,
unmodified design-system usage.

## Conventions

Same as `crm-hubspot-ux/mockups/README.md`: the dashed, striped **Mockup note** strips
are not product UI. People are fictional (Valentina Rojas, Juan Martínez, Ana Pereyra,
Cristian Civita); companies are the same realistic LATAM sample set used elsewhere. The
only interactivity is CSS `:target` for the dialogs and jump-nav, same as every other
mockup in this repo.
