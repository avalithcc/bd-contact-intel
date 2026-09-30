# email-sync mockup parity checklist

Source mockup: `openspec/changes/email-sync/mockups/email-sync.html` (+
`README.md`, decisions 1-9 approved by the owner 2026-09-29). One row per
visible element across the 4 stacked screens; "evidence" is `file:line` in
this worktree once built.

Columns: element | mockup ref | status | evidence | notes

## Screen 1 — Contact record, "Correos" pill (expanded/collapsed/locked threads)

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| "Correos" filter pill (existing) | email-sync.html:140 | done | src/app/(app)/contacts/[id]/Timeline.tsx:180-194 | Pre-existing, unchanged. |
| Thread grouping includes `reply_received` | email-sync.html:151-175 | done | src/lib/contacts/emailThreads.ts:33 (`threadIdOf`) | Extended from `email_sent`-only to also group `reply_received` rows sharing a `gmailThreadId`. |
| Expanded thread card: subject + message-count badge + last time | email-sync.html:152 | done | Timeline.tsx (thread card head) | Pre-existing (branch feat/email-sync-ui-2). |
| "Ver en Gmail" link | email-sync.html:155 | done | Timeline.tsx | New — opens `https://mail.google.com/mail/u/0/#all/<threadId>` in a new tab. |
| Per-message: avatar | email-sync.html:158-174 | done | Timeline.tsx (`Avatar`) | BD messages use `variant="bd"` + actorBdId; contact messages use the record's own person id. |
| Per-message: Enviado/Recibido badge | email-sync.html:159,164,172 | done | Timeline.tsx | `badge-info`/`badge-success` per direction. |
| Per-message: right-aligned time | email-sync.html:159 | done | Timeline.tsx | |
| Per-message: recipient line ("para ...") | email-sync.html:160 | done | Timeline.tsx | Only rendered for `email_sent` (has `to`). |
| "Marcó el estado como Respondió" marker | email-sync.html:165 | done | Timeline.tsx | Compares `entry.id` against `record.statusReason.because.activityId` (status==='replied', source==='activity'). |
| Full body text (not snippet) | email-sync.html:161,166,173 | done | Timeline.tsx | Rendered via on-demand action, `white-space: pre-wrap`, never `dangerouslySetInnerHTML`. |
| Quoted-text collapse toggle | email-sync.html:167-169 | done | Timeline.tsx + src/lib/gmail/splitQuotedText.ts | New `.quoted-toggle`/`.quoted-body` classes added to design-system.css; split is a pure, unit-tested function. |
| "truncated" note | brief (`body_truncated`) | done | Timeline.tsx | Shown when `bodyTruncated` true on a message. |
| Bodies loaded on demand (no initial round trip) | task brief §1 | done | src/app/(app)/contacts/[id]/actions.ts `getThreadBodiesAction`, Timeline.tsx (fetch on expand) | See "New DB reads" in the report. |
| Collapsed thread, "Deducido" badge | email-sync.html:178-181 | done | Timeline.tsx | Reuses existing `inferredBadge` label + `.badge-probable` class (decision 1, already used for "Probable" match confidence). |
| Locked thread (another BD's), names the owner | email-sync.html:184-187 | done | Timeline.tsx (`renderEmailThreadCard`'s locked branch) | Owner feedback (2026-10-01): now reads the owning BD's name off the thread's own (unredacted) `actorName` and renders "Este hilo pertenece a {name}. ... privado para {name} (y los administradores)." — matches the mockup verbatim instead of the generic locked copy. |
| Company timeline locked rows also name the owner | (consistency, not in this mockup) | done | src/lib/companies/timelineView.ts, tests/unit/companyTimelineView.test.ts | Owner feedback (2026-10-01): a company-scoped locked `email_sent` row's headline now reads "{type} · {actorName}" instead of the bare type label, matching the contact record's own locked-row identity. |
| Record note describing the 3 threads | email-sync.html:115 | deviation | — | Mockup-only annotation text about the demo dataset; not real product copy, intentionally not built. |
| Right pane "Historial de conversaciones" card | email-sync.html:192-198 | done (pre-existing) | src/app/(app)/contacts/[id]/page.tsx (assoc card) | Unchanged by this task. |

## Screen 2 — /account/email connection states

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Page header (eyebrow/title/subtitle) | email-sync.html:237 | done | src/app/(app)/account/email/page.tsx | Rewritten onto design-system global classes (`.card`, `.alert-*`) instead of the old CSS module. |
| a) Needs-reconnect state | email-sync.html:239-244 | done | page.tsx + src/lib/gmail/needsReconnectForSync.ts | `badge-warn` "Necesita reconectar", alert-warn body, "Reconectar Gmail" button (existing OAuth start route). |
| b) Connected + syncing state | email-sync.html:246-249 | done | page.tsx | "Última sincronización: hace N min" via `lastSyncedAt`. |
| b·error) Sync error sub-state | email-sync.html:251-256 | done | page.tsx | Reads `sync_error`; `alert-danger` + "Reconectar Gmail". |
| c) First-sync-in-progress state | email-sync.html:258-265 | done (deviation on progress %) | page.tsx | `backfill_page_token IS NOT NULL`. Indeterminate spinner + copy, NOT the mockup's % bar — decision 4 explicitly overridden by the task brief ("show % only if knowable"); `historyList`/`messages.list` give no total up front, so a real percentage cannot be computed. Documented here per the brief's own instruction to fall back to indeterminate copy. |
| "Desconectar" button | email-sync.html:244,249,256 | done | page.tsx, src/app/(app)/account/email/connectionActions.ts | New minimal action: sets `status='disconnected'`, `disconnectedAt=now()`. |
| "Sincronizar ahora" button | email-sync.html:249 | done | page.tsx, connectionActions.ts, src/lib/gmail/syncOneAccountNow.ts | New — extracted the per-account body of `/api/gmail/sync/route.ts` into a shared helper so the cron route and this manual action run identical logic. |
| Spinner on "Sincronizando…" busy button | email-sync.html:265 | done | page.tsx (`.spinner` inside `.btn`, disabled while pending) | |

## Screen 3 — /account/email/never-log

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Route `/account/email/never-log` | README.md decision 2 | done | src/app/(app)/account/email/never-log/page.tsx | Owner-approved location (decision 2). |
| Breadcrumb Cuenta / Gmail / Nunca registrar | email-sync.html:299 | done | page.tsx (via layout breadcrumb prop) | |
| Page header | email-sync.html:304 | done | page.tsx | |
| Chip list (address/domain, with remove ×) | email-sync.html:309-313 | done | page.tsx, src/app/(app)/account/email/never-log/actions.ts (`removeNeverLogEntryAction`, pre-existing in neverLogActions.ts) | |
| Add form (Tipo select + Valor input) | email-sync.html:315-319 | done | page.tsx | |
| Help text re: exact-domain matching | README.md (neverLogRules.ts TODO) | done | page.tsx copy + src/lib/gmail/neverLogRules.ts validation | Copy states domains match exactly, no subdomains. |
| Subtitle states the whole-message exclusion rule | owner feedback 2026-10-01 | done | src/lib/i18n/dictionaries/es.ts/en.ts `accountEmailNeverLog.subtitle` | "Si un correo incluye alguna de estas direcciones o dominios, no se registra en el CRM." The matching backend change (any participant match suppresses the WHOLE message, not just its own side) ships on a separate branch (`classify.ts`) — not touched here. |
| Help text re: own-domain default | email-sync.html:320 | deviation | page.tsx (omitted) | The app has no code path that auto-excludes `avalith.net` by default (verified: `classify.ts` has no such rule) — this looks like flavor copy for the mockup's own example data, not a real default. Flagged for the owner: either (a) approve seeding each BD's list with their own email domain at account-connect time, or (b) drop this line. Not built either way to avoid inventing an unapproved business rule. |
| Empty state (icon + copy + inline form) | email-sync.html:323-332 | done | page.tsx | |
| Input validation (empty / malformed address / malformed domain) | brief | done | src/lib/gmail/neverLogRules.ts (`validateNeverLogInput`) | Unit tested. |

## Screen 4 — one-time reconnect banner

| element | mockup ref | status | evidence | notes |
|---|---|---|---|---|
| Full-width dismissible banner | email-sync.html:369-373 | done | src/components/ReconnectBanner.tsx, src/app/design-system.css (`.reconnect-banner`) | New global component, approved (README decision 6). |
| Banner copy | email-sync.html:370 | done | dictionaries `reconnectBanner.*` | |
| "Reconectar Gmail" CTA inside banner | email-sync.html:371 | done | ReconnectBanner.tsx | Links to `/account/email`. |
| Close (×) button | email-sync.html:372 | done | ReconnectBanner.tsx, src/app/(app)/account/email/connectionActions.ts (`dismissReconnectBannerAction`) | Persisted server-side (decision 5) via `email_account.reconnect_banner_dismissed_at`, not `localStorage` — survives across devices, one nullable timestamp column, no new table. |
| Shown once per BD until reconnect/dismiss | README.md decision 5 | done | src/lib/gmail/reconnectBannerState.ts (pure), src/lib/shell/appShellBadgeCountsQuery.ts (piggybacked) | Derived from the SAME single round-trip query the shell already runs for the task/follow-up badges — no added round trip (see report). |
| Shown above any shell page | email-sync.html:374 (screen note) | done | src/app/(app)/layout.tsx | |

## Deviations needing an owner decision

1. **Thread default state.** The mockup shows thread 1 fully expanded by
   default; the task brief explicitly requires bodies to load on demand
   only when a thread is expanded (no round trip on page load). Every
   thread (including a "Deducido" one) is therefore collapsed by default
   with a "Ver mensajes"/"Ocultar mensajes" toggle not drawn in the static
   mockup — required by the brief's own performance rule, not a silent
   omission.
2. **"Nunca registrar" own-domain default help line** — see the row above.
3. **First-sync progress bar** — see the "c) First-sync-in-progress" row
   above; the brief's own text explicitly authorizes falling back to
   indeterminate copy when a real percentage isn't knowable.

## Screenshots

`src/app/login-email-sync-probe/` (deleted before this branch was done) —
static, hand-copied markup for all 4 screens using the SAME classes/
components the real pages render, so a screenshot is pixel-equivalent
without a live `DATABASE_URL`. Compared against the pre-existing
`screenshoots/email-sync-{1..4}-*.png` mockup reference shots; saved as
`screenshoots/email-sync-impl-*.png` (full page + one crop per screen/
state).
