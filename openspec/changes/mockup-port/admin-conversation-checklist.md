# admin-conversation-access mockup parity checklist

Source mockup: `openspec/changes/admin-conversation-access/mockups/admin-conversation.html`
+ `README.md` (cherry-picked from `docs/admin-conversation-mockup` @ dccf81e onto
`feat/admin-conversation-access`). Backend already existed
(`getConversationForAdmin`, `conversationAudit.ts`, `audit_log`, the
`/contacts/[id]/conversation/[bdId]` route) — this change wires the UI entry
points the mockup designs and closes the `syncedEmails` rendering gap the
mockup's README flags.

**Superseded 2026-09-30 (owner UX complaint, `fix/conversation-modal`)**: two
problems reported against the design below — (1) the viewing BD's own
LinkedIn history (contact-record.html:172-178) expanded INLINE in the narrow
right-rail card, an endless vertical scroll in a narrow column; (2) the
admin's "Ver conversación" confirm dialog (good) navigated to the standalone
"Screen 2" page below (bad). Fix: ONE shared `ConversationDialog`
(`src/components/ConversationDialog.tsx`) used by BOTH paths — height-capped
(~60vh), scrolls internally, opens scrolled to the newest message. "Screen 2"
(the standalone page) is **deleted**; every row below that referenced it now
points at `AdminConversationFlow.tsx` instead. See the new sections at the
bottom of this file for the modal-specific rows (own history + admin content
+ card/timeline parity fix) not covered by the original rows above.

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
| Dialog "Cancelar" / "Ver conversación" footer buttons | admin-conversation.html:159 | done — **redirected 2026-09-30** | AdminViewConversationDialog.tsx, AdminConversationFlow.tsx:91-103 | Confirm now calls `onConfirm` (a plain button, not a `<Link>`), which `AdminConversationFlow` turns into the audited `revealAdminConversationAction` call, then renders the content straight into the shared `ConversationDialog` — no more navigating to a separate page. |
| Right-rail "Historial de conversaciones" card, admin-only, one "Ver" per BD with locked content | admin-conversation.html:138-144 | done | src/app/(app)/contacts/[id]/ConversationHistoryCard.tsx, src/lib/activity/lockedConversationSummaries.ts | "Ver" now opens `AdminConversationFlow` (the shared modal) instead of setting a `pending` bdId that only fed a confirm-then-navigate dialog. |
| Non-admin never sees any of the above | admin-conversation.html's own note: "vista por un administrador" | done | Timeline.tsx (`isAdmin` prop gate, already threaded from page.tsx), tests/unit/adminConversationButtonVisibility.test.ts | Gate is server-known (`isAdmin` computed server-side in page.tsx from `me.role`), not just CSS-hidden. |

## Screen 2 — Conversation view (admin only) — **page deleted 2026-09-30, folded into the shared modal**

The standalone `/contacts/[id]/conversation/[bdId]` page and its
`page.module.css` are deleted. Every row below is now served by
`AdminConversationFlow.tsx` rendering into `ConversationDialog`
(`src/components/ConversationDialog.tsx`), opened from either
ConversationHistoryCard's "Ver" button, Timeline's per-locked-row action, or
Administración → Registro de auditoría's "Abrir" link (`?conversation=<bdId>`,
via `AdminConversationAutoOpen.tsx`) — see the Screen 3 row below.

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| `requireAdmin()` guard, no content for non-admins | admin-conversation.html (route reused, unchanged) | done | src/app/(app)/contacts/actions.ts `revealAdminConversationAction` | Now enforced inside the server action every entry point calls, not a page-level 404 — a non-admin's client never even gets `AdminConversationAutoOpen` rendered (page.tsx gates on `isAdmin` server-side first). |
| Audit write BEFORE read, exactly once per confirmed view | README "known implementation gap" is about rendering, not this | done | src/lib/activity/getConversationForAdmin.ts (unchanged), AdminConversationFlow.tsx (fetch effect fires once per mounted instance) | Each "Ver"/"Abrir" click mounts a fresh `AdminConversationFlow` (`key={bdId}`); its fetch effect only ever runs once per mount (guarded by `phase !== "loading"`), so hover/prefetch/re-render can never trigger a second audit write. |
| Back link "Volver a la ficha" | admin-conversation.html:210 | deviation | — | Not needed anymore — closing the modal (×, Escape, backdrop click) returns to the record page underneath, which was always visible. No dedicated back-link element in a modal. |
| Breadcrumbs | admin-conversation.html:205 | n/a | — | Modal, not a page — no breadcrumb slot applies. |
| Modal title "Conversación con {bd}" | admin-conversation.html:211 (adapted) | done | AdminConversationFlow.tsx:105-106, es.ts `contactRecord.conversationDialogTitlePrefix` | Dialog title, not a page h1 — same "Conversación con X" copy. |
| Audit banner (`.alert-audit`), exact required text "Estás viendo la conversación de X como administrador — este acceso quedó registrado" | task instruction (2026-09-30) | done | AdminConversationFlow.tsx:118-129, es.ts `contactRecord.adminAuditBannerPrefix`/`adminAuditBannerSuffix` | **Deviation**: the old page's secondary detail line ("Registro de auditoría: {actor} · conversación de {bd} con {contact} · {date}.") is dropped — it needed the admin's own name and a formatted date, both awkward to plumb into a client component for no requirement beyond the one line above. Flagging for owner sign-off. |
| "Correos sincronizados" section — `syncedEmails` rendered as threads, body as TEXT never HTML | admin-conversation.html:213-228 | done | AdminConversationFlow.tsx:131-160, src/lib/gmail/groupSyncedEmailThreads.ts, src/components/EmailThreadMessage.tsx | Same grouping/rendering as the deleted page, ported into the modal body. |
| Legacy `emailEntries` section | not in the mockup | deviation (carried) | AdminConversationFlow.tsx:162-179 | Same carried deviation as before — still rendered, not dropped. |
| "Conversación de LinkedIn" section, empty state when none | admin-conversation.html:230-238, 298-299 | done | AdminConversationFlow.tsx:181-203 | Messages run through `sortMessagesChronologically` (defense-in-depth — the DB query is already `ORDER BY sentAt ASC`) before rendering, oldest first. |
| Dialog body height-capped (~60vh), scrolls internally, opens scrolled to the newest message | task instruction (2026-09-30) | done | src/components/ConversationDialog.tsx, `.dialog-body-scroll` in src/app/globals.css | Scoped CSS class, not a change to the base `.dialog-body` every other dialog also uses. |
| Toast "Visualización registrada..." on arrival | admin-conversation.html:303 | deviation (carried) | — | Same as before: the persistent audit banner already states this. |

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
| "Abrir" reopens the conversation, no re-confirmation | admin-conversation.html:346-349 | done — **redirected 2026-09-30** | admin-log/page.tsx:120-128, AdminConversationAutoOpen.tsx | `<Link href="/contacts/[personId]?conversation=[targetBdId]" prefetch={false}>` (still `prefetch={false}` — never a bare Link to an audited target). The record page validates the param (`resolveConversationDialogParam`) and, only when `isAdmin` is already true server-side, renders `AdminConversationAutoOpen`, which skips the confirm step (admin already confirmed by clicking "Abrir") and opens the modal directly — same audited read, no re-confirmation, matches README §3. |

## Own conversation history modal — case 1 (owner UX complaint 2026-09-30)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Row keeps showing count + last message date + trigger button | contact-record.html:172-178 | done | src/app/(app)/contacts/[id]/ConversationHistoryCard.tsx, OwnConversationHistory.tsx | Unchanged row markup; only the expansion behavior changed. |
| Inline vertical expansion in the narrow sidebar column | — | **removed** (was the reported bug) | OwnConversationHistory.tsx | Replaced entirely by the shared modal below. |
| "Ver mensajes" opens the shared `ConversationDialog`, content fetched on demand (no round trip on page load) | task instruction | done | OwnConversationHistory.tsx (`openDialog`, `getOwnConversationMessagesAction`) | Same action/query as before (`getOwnConversationMessages`, scoped to `bd_id = currentBd`), just triggering a modal open instead of an inline toggle. Cached after first load — reopening doesn't refetch. |
| Messages oldest-first, dialog opens scrolled to the newest | task instruction (chat convention) | done | OwnConversationHistory.tsx (`sortMessagesChronologically`), ConversationDialog.tsx (scroll-to-bottom effect) | |
| Text only, never HTML | task instruction | done (pre-existing) | OwnConversationHistory.tsx — `{m.content}` rendered as a React text node | Unchanged from the previous inline version. |
| Modal title "Conversación con {contact}" | task instruction (no exact mockup for this new modal) | done | ConversationHistoryCard.tsx (`dialogTitle` prop) | Titled by the CONTACT (the counterpart of this BD's own conversation), not by the row's own `bdName` label. |

## Card/timeline locked-row parity (owner-reported bug 2026-09-30)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Non-admin sees a locked row (name, count, date, no content) for another BD's LinkedIn connection, matching what Timeline already shows | contact-record.html:179-185; spec "non-admins MAY see which BDs have history..., never the content" | done | src/lib/contacts/conversationHistoryAccess.ts `resolveLockedConnectionCardRows`, src/app/(app)/contacts/[id]/page.tsx (`nonAdminLockedConversationRows`), ConversationHistoryCard.tsx (`lockedRows` prop) | Previously the card rendered NOTHING here for a non-admin; Timeline already showed a locked marker for the same connection (`isLinkedinEntryLocked`). Both now agree on the same underlying set. |
| Locked row shows a plain lock icon, no action | contact-record.html:182-183 (meta icon, not a button) | done | ConversationHistoryCard.tsx (`<LockIcon className="icon" />` in a `<span className="meta">`) | |
| Footer text stays "El contenido es privado para cada BD." for a non-admin | contact-record.html:184 | done (pre-existing) | ConversationHistoryCard.tsx (`conversationHistoryPrivateFooter`, unchanged branch) | |

## Tests

| what | status | evidence |
|---|---|---|
| Admin-only button visibility (pure predicate) | done | tests/unit/adminConversationAccess.test.ts (RED confirmed by hand: probed `canShowAdminConversationAction` to always return `false`, saw 1 failing assertion, then restored) |
| Audit-list query builder/pagination (pure) | done | tests/unit/pagination.test.ts (RED confirmed: module didn't exist yet, `MODULE_NOT_FOUND`) |
| Synced-email thread grouping (pure) | done | tests/unit/groupSyncedEmailThreads.test.ts (RED confirmed: module didn't exist yet) |
| "The BD never sees audit info" — no non-admin code path reads `audit_log` `view_conversation` rows | done | tests/unit/auditLogAccessScope.test.ts (static scan: only `auditLogQueries.ts` selects `view_conversation` rows from `audit_log`; its only importer is under `src/app/(app)/admin/`) |
| Message ordering (pure) | done | tests/unit/conversationMessageOrder.test.ts (RED confirmed: `MODULE_NOT_FOUND`, then implemented — see `fix/conversation-modal` first commit) |
| `?conversation=` param validation (pure) | done | tests/unit/conversationDialogParam.test.ts (RED confirmed: `MODULE_NOT_FOUND`) |
| Card/timeline locked-row access resolution (pure) | done | tests/unit/conversationHistoryAccess.test.ts (RED confirmed: `resolveLockedConnectionCardRows is not a function`) |
| Guard tests still pass (iconSizing, dialogMarkup, rethrowNavigationErrors, recordButtonMarkup) | done | `npm run test:unit` — 1792 passing, 0 failing (both TZ=UTC and TZ=America/Argentina/Buenos_Aires) |

## Owner decisions still open (carried from README, not blocking this PR)

- README decisions 3/4 (redundant entry points; (contact, BD)-scoped destination) — resolved by this task's own instructions: both entry points kept, route stays (contact, BD)-scoped.
- README decision 5 (scope of the audit page) — resolved: `view_conversation`-only for now.
- README decision 6 (`.locked-actions`) — resolved: accepted as-is, folded into `design-system.css`.
- README decision 7 (retention window) — resolved: no limit, paginated.
- README decision 8 (button copy) — resolved: reuses the existing `viewConversationLink`/`viewConversationAuditHint` dictionary pair.
- README decision 1/2 (BD notification / BD-visible audit surface) — resolved by the 2026-09-30 owner note: no notification, no BD-visible surface at all; audit is admin-only.
