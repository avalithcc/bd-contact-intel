# admin-conversation-access mockup parity checklist

Source mockup: `openspec/changes/admin-conversation-access/mockups/admin-conversation.html`
+ `README.md` (cherry-picked from `docs/admin-conversation-mockup` @ dccf81e onto
`feat/admin-conversation-access`). Backend already existed
(`getConversationForAdmin`, `conversationAudit.ts`, `audit_log`, the
`/contacts/[id]/conversation/[bdId]` route) — this change wires the UI entry
points the mockup designs and closes the `syncedEmails` rendering gap the
mockup's README flags.

**Owner decision (2026-09-30), overriding the mockup's own copy**: the BD is
NOT notified and must NOT be able to see that an admin viewed their
conversation. The confirmation dialog and the audit banner no longer say the
owner "va a poder ver que la visualizaste" — they only state that the view is
recorded in the admin-only audit log. `README.md` and the `.html` mockup are
updated in place to match (not left showing the old promise) — see the
"Owner decision" note prepended to both files.

Columns: element | mockup ref | status | evidence file:line | notes

## Screen 1 — Contact record (admin view), locked thread rows

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Ver conversación (queda registrado)" action on a locked SYNCED EMAIL THREAD row | admin-conversation.html:112-116 | done | src/app/(app)/contacts/[id]/Timeline.tsx:918-921 (renderEmailThreadCard, locked branch) | Renders only when `canShowAdminConversationAction({isAdmin, locked, targetBdId})` is true (src/lib/activity/adminConversationAccess.ts). In practice a foreign thread's own messages never carry `metadata` (redacted, per isTimelineEntryVisible), so `groupEmailThreads` can never merge 2+ of them into one `kind: "thread"` group — this branch stays defensive/future-proof; the single-entry branch below is the one real foreign threads actually render through today. Noted so the gap is documented, not silently assumed away. |
| Same action on a locked LEGACY/single email_sent or reply_received row (the branch real foreign-thread messages actually render through) | admin-conversation.html — implied by README's "email_sent" scope | done | Timeline.tsx:1133-1134 (single-entry locked branch) | Also fixed the same branch's locked-row copy to name the owning BD (Timeline.tsx:1106-1129), matching the thread-locked branch's existing "Este hilo pertenece a X..." text instead of the generic `timelineLockedContent` fallback — see the standalone `fix(contact-record)` commit. |
| Same action on a locked LEGACY LinkedIn conversation row | admin-conversation.html:118-124 | deviation | — | LinkedIn timeline rendering is entirely disabled app-wide today (owner: "turned LinkedIn ingestion off", see Timeline.tsx's top-of-file NOTE and BACKLOG.md `admin-email-conversation-access`: "near-zero impact today, one email_sent row"). No LinkedIn row ever renders for ANY viewer, admin or not, so there is no row to attach the action to. Restoring `connections`/`viewerBdId` on Timeline is out of scope for this change (separate backlog item). |
| Confirmation dialog (repo `<Dialog>` pattern) | admin-conversation.html:152-160 (`#confirm-view-juan`) | done | src/app/(app)/contacts/[id]/AdminViewConversationDialog.tsx | Uses the shared `Dialog` component (dialogMarkup-guard-clean), not the mockup's raw `.overlay`/`:target` markup. |
| Dialog body names both people + audit `.alert-audit` box | admin-conversation.html:156-157 | done | AdminViewConversationDialog.tsx | Copy changed per owner decision above — no "el BD va a poder ver" line, no link to "decisión pendiente" (that decision is now resolved). |
| Dialog "Cancelar" / "Ver conversación" footer buttons | admin-conversation.html:159 | done | AdminViewConversationDialog.tsx | Confirm navigates client-side to `/contacts/[id]/conversation/[bdId]`; no server action fires from the dialog itself (audit write happens on the destination page, unchanged). |
| Right-rail "Historial de conversaciones" card, admin-only, one "Ver" per BD with locked content | admin-conversation.html:138-144 | done | src/app/(app)/contacts/[id]/page.tsx (record-right aside), src/lib/activity/lockedConversationSummaries.ts | New card, admin-only — the pre-existing LinkedIn-only version of this card is still commented out in page.tsx (untouched, separate concern); this is a distinct, email-scoped card gated on `isAdmin`. One extra query, only paid by admins. |
| Non-admin never sees any of the above | admin-conversation.html's own note: "vista por un administrador" | done | Timeline.tsx (`isAdmin` prop gate, already threaded from page.tsx), tests/unit/adminConversationButtonVisibility.test.ts | Gate is server-known (`isAdmin` computed server-side in page.tsx from `me.role`), not just CSS-hidden. |

## Screen 2 — Conversation view (admin only)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `requireAdmin()` guard, 404 for non-admins | admin-conversation.html (route reused, unchanged) | done (pre-existing) | src/app/(app)/contacts/[id]/conversation/[bdId]/page.tsx | Unchanged by this PR. |
| Audit write BEFORE read, once per page view, no dev-double-render duplicate in prod | README "known implementation gap" is about rendering, not this | done (pre-existing) | src/lib/activity/getConversationForAdmin.ts | Documented: React/Next's dev-mode double-invoke only double-renders Server Components in the same request tree; it does not re-run the request twice, so the audit insert (inside the request's own `db.transaction`) fires exactly once per navigation in both dev and prod. No test can observe React internals here, so this is a doc-only confirmation, not a new test. |
| Back link "Volver a la ficha" | admin-conversation.html:210 | done (pre-existing) | conversation/[bdId]/page.tsx:84-85 | |
| Breadcrumbs ("Contactos / {contact} / Conversación con {bd}") | admin-conversation.html:205 | deviation | — | Breadcrumbs live in the shared `<TopBar>` (src/app/contacts/TopBar.tsx), rendered once per app-wide layout with no per-page breadcrumb slot today — every other record-adjacent page in this app has the same gap (out of scope: would mean threading breadcrumb data through the shared layout for every route, not just this one). |
| Page header eyebrow "Conversación con {bd}" + h1 contact name | admin-conversation.html:211 | done | conversation/[bdId]/page.tsx:88-96 | Restructured from the old single `<h1>{title} {bdName} · {name}</h1>` into the mockup's eyebrow/h1 split. |
| Audit banner (`.alert-audit`), title names the BD, body names actor+contact+date | admin-conversation.html:208 | done | conversation/[bdId]/page.tsx:100-106, es.ts `adminConversation.auditBannerTitle`/`auditBannerBody` | Copy: "conversación de {bd}" — no "podrá ver que la visualizaste" language (per owner decision). |
| "Correos sincronizados" section — `syncedEmails` rendered as threads (grouped by `gmailThreadId`), body as TEXT never HTML | admin-conversation.html:213-228 | done | conversation/[bdId]/page.tsx:108-160, src/lib/gmail/groupSyncedEmailThreads.ts, src/components/EmailThreadMessage.tsx | Closes the README-flagged gap: `getConversationForAdmin` already returned `syncedEmails`; the page never read it. `bodyText` is rendered as a plain-text node (React's default escaping) — never `dangerouslySetInnerHTML`; `emailMessage.bodyText` is stored as plain text only. |
| Legacy `emailEntries` section (manual `email_sent`, pre-email-sync) | not in the mockup (email-sync-era-only data) | deviation | conversation/[bdId]/page.tsx:161-171 | Mockup only shows synced mail because its sample data has no legacy rows; `getConversationForAdmin.emailEntries` still exists and must not be silently dropped (task instruction). Kept as its own "Correos (registro manual)" section below the synced one, same card style as before this change. |
| "Conversación de LinkedIn" section, `.empty` state when none | admin-conversation.html:230-238, 298-299 | done (pre-existing, restyled) | conversation/[bdId]/page.tsx:173-206 | Content unchanged (still legacy `conversation`/`message` rows); markup restyled onto `.thread`/`.thread-msg`/`.empty` to match the mockup instead of the old ad hoc `<div className={styles.card}>`. |
| Toast "Visualización registrada..." on arrival | admin-conversation.html:303 | deviation | — | The persistent `.alert-audit` banner (role="status") already always states this; a one-shot toast on top would need a client wrapper around a Server Component page for no added information. Skipped — flagging for owner sign-off, not silently dropped. |

## Screen 3 — Administración → Registro de auditoría

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Sidenav "Administración" section, admin-only, "Registro de auditoría" item | admin-conversation.html:57-61 | done | src/app/contacts/Sidebar.tsx (new admin-only `nav-section`), src/app/(app)/layout.tsx (`isAdmin={me.role === "admin"}`) | Mockup also shows "Duplicados"/"Migración" under this same section, but those two routes are NOT in today's real Sidebar at all (pre-existing gap, not introduced by this change) — adding only "Registro de auditoría" here per this task's explicit scope; wiring the other two into nav is a separate, undirected change. |
| New route `/admin/audit-log`, `requireAdmin()`, 404 for non-admins | admin-conversation.html:310-355 | done | src/app/(app)/admin/audit-log/page.tsx:32-41 | Same 404-not-403 convention as `/admin/duplicates`/`/admin/migration`. |
| Page header ("Registro de auditoría.", subtitle) | admin-conversation.html:340 | done | admin-log/page.tsx:48-58 | |
| `table.data`: Cuándo / Administrador / Contacto / "Conversación de" / Abrir | admin-conversation.html:344-350 | done | admin-log/page.tsx:76-138, src/lib/activity/auditLogQueries.ts | One rows query (2 `bd` joins via `alias()` + a `person` join) + one count query — no per-row query. |
| Pagination footer ("Mostrando N de N") | admin-conversation.html:352 | done | admin-log/page.tsx:139-155 | Reuses the same `table-footer`/`prevPage`/`nextPage` convention as `/companies`, not the mockup's fixed "últimos 90 días" copy. |
| "Últimos 90 días" retention window | admin-conversation.html:339,352 | deviation | admin-log/page.tsx | Owner decision (2026-09-30): no retention limit in the UI — show everything, paginated. Mockup note text dropped; page shows the true total instead of a 90-day-scoped one. |
| Real note (not dashed mockup chrome) pointing at `/admin/duplicates#history` for other audited actions | admin-conversation.html:339 | done | admin-log/page.tsx:60-67 (`.alert.alert-info`) | Scoped per owner decision: this table stays `view_conversation`-only. |
| "Abrir" reopens the conversation, no re-confirmation | admin-conversation.html:346-349 | done | admin-log/page.tsx:120-128 | Plain `<Link>` to `/contacts/[personId]/conversation/[targetBdId]` — admin already has the audit trail open, matches README §3. |

## Tests

| what | status | evidence |
|---|---|---|
| Admin-only button visibility (pure predicate) | done | tests/unit/adminConversationAccess.test.ts (RED confirmed by hand: probed `canShowAdminConversationAction` to always return `false`, saw 1 failing assertion, then restored) |
| Audit-list query builder/pagination (pure) | done | tests/unit/pagination.test.ts (RED confirmed: module didn't exist yet, `MODULE_NOT_FOUND`) |
| Synced-email thread grouping (pure) | done | tests/unit/groupSyncedEmailThreads.test.ts (RED confirmed: module didn't exist yet) |
| "The BD never sees audit info" — no non-admin code path reads `audit_log` `view_conversation` rows | done | tests/unit/auditLogAccessScope.test.ts (static scan: only `auditLogQueries.ts` selects `view_conversation` rows from `audit_log`; its only importer is under `src/app/(app)/admin/`) |
| Guard tests still pass (iconSizing, dialogMarkup, rethrowNavigationErrors, recordButtonMarkup) | done | `npm run test:unit` — 1703 passing, 0 failing |

## Owner decisions still open (carried from README, not blocking this PR)

- README decisions 3/4 (redundant entry points; (contact, BD)-scoped destination) — resolved by this task's own instructions: both entry points kept, route stays (contact, BD)-scoped.
- README decision 5 (scope of the audit page) — resolved: `view_conversation`-only for now.
- README decision 6 (`.locked-actions`) — resolved: accepted as-is, folded into `design-system.css`.
- README decision 7 (retention window) — resolved: no limit, paginated.
- README decision 8 (button copy) — resolved: reuses the existing `viewConversationLink`/`viewConversationAuditHint` dictionary pair.
- README decision 1/2 (BD notification / BD-visible audit surface) — resolved by the 2026-09-30 owner note: no notification, no BD-visible surface at all; audit is admin-only.
