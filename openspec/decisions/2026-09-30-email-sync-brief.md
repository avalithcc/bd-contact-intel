# Decision brief — email sync (log inbound and outbound mail on the contact)

Prepared 2026-09-29. Analysis only — no application code, no production writes.

## Summary

| | |
| --- | --- |
| Problem | `person.status` can only reach `replied` from an inbound signal (`src/lib/status/deriveStatus.ts:91-95`, `reply_received`). Nothing writes one, so no BD action in the app can move a contact past `contacted`. |
| Today | Gmail is **send-only**: the OAuth scope is `gmail.send` (`src/app/api/gmail/oauth/start/route.ts:29`). Two BDs are connected (Cristian, Macarena). One `email_sent` activity exists (a self-test). Mail sent from Gmail or Mac Mail and every reply are invisible to the CRM. |
| Recommendation | Poll Gmail's history API per connected BD, triggered by **Supabase `pg_cron` every 15 minutes** (see the correction below). Store matched mail in a new `email_message` table. Write one `reply_received` activity for the first inbound message of a thread. Only threads with CRM-known addresses are stored, never the whole mailbox. |
| Scope | `gmail.readonly`. The OAuth app is Internal, so no Google verification is needed, but every BD must reconnect once. |
| Effort | 5 slices, each ≤ 400 lines of code. |

## Correction — scheduling on the Hobby plan

The first draft assumed an hourly Vercel cron. **The Hobby plan allows cron jobs at most once per day**, and a more frequent expression fails the deployment. Source: https://vercel.com/docs/cron-jobs/usage-and-pricing, checked 2026-09-29. Options to trigger the sync:

| Option | Frequency | Cost | Notes |
| --- | --- | --- | --- |
| **Supabase `pg_cron` + `pg_net` calling `/api/gmail/sync`** (recommended) | every 15 min (any) | free on the current Supabase plan | Runs inside the database the app already uses. The bearer secret lives in Supabase Vault. The extensions need a one-time enable in the dashboard. |
| Vercel Pro | per minute | paid per seat | Also lifts other Hobby limits. |
| GitHub Actions `schedule` | ≥ 5 min, often delayed | free minutes are limited on private repos | Runs every 15 min exceed the free quota, every 30 min fit. |
| Daily Vercel cron only | once a day | free | A reply shows up the next day. Too slow for a 3-day `replied` follow-up rule. |

A daily Vercel cron can stay as a safety net behind `pg_cron`.

## Current state

- **Send flow:** `src/lib/gmail/send.ts` refreshes the token, calls `users.messages.send`, and writes an `email_sent` activity with `{ to, subject, gmailMessageId, gmailThreadId }` (`send.ts:146-157`). Nothing enforces uniqueness on `gmailMessageId`.
- **Tokens:** one AES-256-GCM encrypted refresh token per BD in `email_account`. A revoked token flips `status` to `error` (`src/lib/gmail/errors.ts:18-41`).
- **Status contract:** a `reply_received` activity is all that `deriveStatus` needs. `src/lib/contacts/board.ts:9-15` documents it as reserved for email sync.
- **Storage precedent:** the LinkedIn `conversation`/`message` tables with `unique(bd_id, content_hash)` for idempotent re-import (`src/db/schema.ts:335-413`).
- **Privacy:** `src/lib/activity/timelineVisibility.ts:18-27` hides conversation content from other BDs, but only for the types listed in `CONVERSATION_CONTENT_TYPES`. Any new inbound-mail type must be added there in the same change, or it leaks. Admins read other BDs' mail through `getConversationForAdmin`, which writes an audit row.
- **Matching:** `person.email_normalized` is indexed and includes the 480 emails deduced by pattern (`email_source = 'pattern_inferred'`). A match against a deduced address should be flagged as such.
- **Pool:** production pool `max: 3`, session mode. The sync must process BDs sequentially, never `Promise.all` across mailboxes (`PERFORMANCE.md`).

## Options (transport)

- **Push (Pub/Sub `users.watch`):** needs a GCP topic, a webhook, and a 7-day watch renewal. It still calls `history.list` per notification, so it only adds infrastructure on top of polling.
- **Poll `users.history.list` (recommended):** stores `historyId` per BD. On a 404 (stale history, older than about 7 days) it re-baselines with a bounded `messages.list`. Each BD's failure is isolated from the others.
- **Hybrid:** only worth it if 15 minutes proves too slow.

## Recommendation details

- **One row per Gmail message** in `email_message`: `unique(bd_id, gmail_message_id)`, plus `direction`, `person_id`, `thread_id`, `snippet` or body, `matched_email`, and `match_confidence`. Platform-sent mail is deduplicated by `gmail_message_id`.
- **The timeline shows every synced message** of a thread. Status changes once, on the first inbound message (`reply_received`).
- Sync processes BDs sequentially with a per-BD time budget.

## Slices (each ≤ 400 lines of code)

1. `gmail.readonly` scope, `history_id`/`last_synced_at` on `email_account`, and a reconnect prompt for BDs whose grant predates it.
2. The `email_message` table and a pure, unit-tested matcher/classifier.
3. The `/api/gmail/sync` route (bearer auth like the existing crons), incremental history polling, dedup, the `reply_received` activity, and the `pg_cron` trigger.
4. The first-sync backfill over a bounded window.
5. Timeline rendering, privacy (`CONVERSATION_CONTENT_TYPES`), and the admin view.

The timeline rendering in slice 5 needs a mockup before code.

## Owner decisions

**Decided 2026-09-29 — logging model.** Log automatically every thread with a CRM-known address, with no per-email "Log" checkbox (HubSpot requires one, via its Chrome extension or a BCC address), **plus a per-BD "never log" list** of addresses and domains, as in HubSpot. The owner's aim is to improve on HubSpot, not only match it.

Still open:

1. **Trigger:** `pg_cron` every 15 minutes (free, recommended) or Vercel Pro.
2. **Content kept:** the snippet only (about 200 characters) or the full body. The full body is what HubSpot shows, but it means storing email content (retention, deletion on request).
3. **First-sync window:** how far back to pull on connect (recommended: 90 days).

## Risks

- Every BD must reconnect Gmail before anything is synced for them.
- If the new type is not added to `CONVERSATION_CONTENT_TYPES` in the same slice, one BD's mail becomes visible to every other BD.
- Without the unique `(bd_id, gmail_message_id)`, a history re-baseline would duplicate timeline entries.
