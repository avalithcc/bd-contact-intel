# Backlog

Changes agreed with the owner but not started. Each becomes its own SDD change under `openspec/changes/` when picked up.

## email-sync

Two-way email logging on the Contact timeline, HubSpot-style.

- Log emails sent from the platform and from the BD's own mail client, plus replies, as threads.
- Only threads with contacts that exist in the CRM; never the whole mailbox.
- Requires a read scope (`gmail.readonly`). The OAuth app is Internal, so no Google verification is needed, but every BD must reconnect Gmail.
- Sync via Gmail push notifications (Pub/Sub `users.watch`) or a cron over the history API.
- Deduplicate messages already sent from the platform.
- Admins can always view every conversation; each admin view of another BD's conversation is recorded in an audit log.
- Depends on `crm-hubspot-ux` (the Contact timeline is designed to render email threads).

## owner-reporting

Reports for the platform owner (admin) to act on pipeline data.

- Discard reasons breakdown (e.g. share of "not the right profile" points at list sourcing, not outreach).
- Funnel conversion by stage and by contact source (LinkedIn, imported list, scraping).
- Activity per BD over time.
- Depends on `crm-hubspot-ux` storing these facts as structured data: discard reason as a fixed code (not free text), contact source provenance, and timestamped activities.

## auth-ux

Login gaps found while testing the crm-hubspot-ux preview (2026-09-24).

- No "forgot password" flow: a BD without an open session is locked out and needs a manual reset in Supabase. Add Supabase password recovery (email link → `/auth/confirm` → set new password).
- After login the app always lands on `/`, ignoring the page that was requested. Return to the original URL (a validated, same-origin `next` parameter), as HubSpot does.

## Deferred from crm-hubspot-ux

- Global cross-object search.
- Company record page and company pipeline board (`relationshipStage`).
- Task queue filters and bulk actions.
