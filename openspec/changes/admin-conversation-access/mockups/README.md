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
   audited and visible to the conversation's owner, then goes to screen 2. The
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

## Owner decisions needed

<a id="decision-1"></a>
1. **Does the BD get notified?** The confirmation dialog (screen 1) states the view is
   logged and that the owning BD "podrá ver que la visualizaste en su propio registro" —
   i.e., passively visible if they go looking. It does **not** mock an active
   notification (email, in-app toast, Slack). Decide whether viewing another BD's
   conversation should also push a notification to that BD, and if so, immediately or
   batched (e.g., in the existing digest email). This is the one explicitly called out
   in the task and is left open on purpose — the dialog links to this decision instead
   of guessing.
2. **Where does "visible to the owner" actually surface?** Right now the *only* audited
   view of `audit_log` is the admin-only page in screen 3. A BD has no UI path today to
   see "an admin viewed my conversation with Valentina Rojas" — the dialog's promise
   ("Juan va a poder ver que la visualizaste") isn't backed by any screen yet. Decide
   whether to (a) build a BD-scoped filtered view of the audit trail, (b) add an inline
   marker on the BD's own locked-row equivalent — but BDs never see the locked row for
   *their own* content, they see it normally — so more likely on the conversation's
   activity item itself ("Vista por un administrador el 15 oct"), or (c) leave the
   promise as aspirational until decision 1 lands, since a notification would make it
   moot.
3. **Redundant entry points per BD.** Screen 1 shows the new button on *every* locked
   row (2 rows for Juan Martínez: one email thread, one LinkedIn conversation), plus a
   third "Ver" link in the right-rail "Historial de conversaciones" card for the same
   BD. All three navigate to the same combined conversation page. Confirm this
   duplication is acceptable (each is contextual: click from wherever you're looking)
   or whether the per-row action should be dropped in favor of the single right-rail
   entry point, to avoid a wall of identical buttons on contacts with many locked rows.
4. **Multi-thread targets share one destination.** Related to (3): the route is
   `/contacts/[id]/conversation/[bdId]` — scoped to (contact, BD), not to an individual
   thread. So two locked rows for the same BD always link to the same page, which then
   shows *all* of that BD's content with this contact (both channels), not just the
   thread that was clicked. Confirm this is the intended granularity (matches the
   existing route/`getConversationForAdmin` signature) rather than a thread-scoped view.
5. **Scope of the audit trail page.** Mocked as `view_conversation` entries only.
   `audit_log.action` also covers `merge`, `unmerge`, `not_duplicate`,
   `migration_approve`, `migration_execute`, `bd_password_reset` — and merges already
   have their own history table (`duplicates.html#history`). Decide whether "Registro de
   auditoría" should stay scoped to conversation views (this mockup) or become a general
   audit log that supersedes/links to the merge history table too.
6. **New component: action inside `.locked`.** No existing `.locked` usage (today's
   LinkedIn/`email_sent` privacy rule, or the email-sync mockup) puts an interactive
   control inside the block — it has always been read-only chrome for non-admins. This
   mockup adds `.locked-actions` (flagged inline in the `<style>` block) as a thin
   wrapper so the button sits visually inside the locked card without changing
   `.locked`'s own layout. Needs sign-off before folding into `styles.css`.
7. **Retention window on the audit table.** Mocked as "últimos 90 días" (matching the
   email-sync backfill window, for visual consistency only — there's no other reason to
   couple them). `audit_log` has no TTL today. Decide the real bound: a fixed lookback
   window (needs an indexed `at` filter, cheap), full history with pagination (more
   correct, costs a `COUNT`/keyset query), or both (default 90 days, with an explicit
   "ver todo" escape hatch).
8. **Button copy.** The task text says `"Ver conversación (queda registrado)"`; the
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
