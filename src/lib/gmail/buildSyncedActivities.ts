/**
 * Pure planner: turns one classified, newly-inserted `email_message` into
 * the `activity` row(s) to write in the same transaction (fresh-review
 * design change, 2026-09-30 — replaces the old "one reply_received per
 * thread" model, which had 3 bugs: a backfilled 60-day-old reply looked like
 * a fresh touch (created_at = sync time), outbound Gmail mail was never a
 * touch at all, and "earliest inbound across runs" was fragile against
 * newest-first backfill paging).
 *
 * New model: every stored message -> exactly ONE activity row per matched
 * person — inbound -> `reply_received`, outbound -> `email_sent` — EXCEPT a
 * platform-sent outbound message, which already has an `email_sent`
 * activity from src/lib/gmail/send.ts (syncQueries.ts links it instead of
 * calling this). Idempotency comes from `email_message`'s own
 * `unique(bd_id, gmail_message_id)` (ON CONFLICT DO NOTHING) — a message is
 * only ever inserted once, so this only ever runs once per message,
 * `syncedActivityIdempotencyKey` documents/tests that (person, message)
 * pairs never collide within one call, it is not itself a DB constraint.
 *
 * `metadata.occurredAt` (ISO string) carries the message's real send time;
 * `created_at` (set by the caller's INSERT, not here) is the sync/
 * processing time — this activity is NOT backdated, same convention as a
 * `call`/`status_backfill` row (src/lib/status/deriveStatus.ts). Once
 * `effectiveActivityAtSql()`/`activityRowToStatusEvent()` are updated to
 * honor `metadata.occurredAt` for `email_sent`/`reply_received` too
 * (blocked on the feat/follow-up-queue merge — DO NOT touch
 * effectiveActivityTime.ts before that lands), "Última actividad" and the
 * follow-up queue will read the real message time instead of processing
 * time. deriveStatus's stage mapping (`email_sent` -> contacted,
 * `reply_received` -> replied, max-rank-wins) already works correctly today
 * regardless of that pending change.
 *
 * Privacy: metadata carries only `subject` and addresses, never the body —
 * both types are in CONVERSATION_CONTENT_TYPES
 * (src/lib/activity/timelineVisibility.ts), scoped per BD like `email_sent`
 * always was.
 */
import type { ClassifiedMatch, MatchConfidence } from "./classify";

// `auto_reply_received` is an inbound message the detector (automatedMessage.ts) flagged as machine-generated, e.g. an
// out-of-office. It is its own type so the stage derivation stays neutral to it by construction: the Contact has not
// answered, and must stay in the follow-up cadence. It carries the same metadata as `reply_received`.
// It also covers bounces and delivery failures (the detector flags those `automated` too). ONE label,
// "Respuesta automática", was considered and kept on purpose: both are mail a system wrote, neither
// is an answer, and the card shows the subject and sender ("Undeliverable: ...", mailer-daemon), which
// says what happened. A second type or label would add a branch in every registry for no decision a BD
// takes differently. (A bounce only reaches this type when its sender matches a Contact, which is rare.)
export type SyncedActivityType = "email_sent" | "reply_received" | "auto_reply_received";

export interface SyncedActivityMetadata {
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  from?: string;
  to?: string[];
  matchedEmail: string;
  matchConfidence: MatchConfidence;
  source: "gmail_sync";
  occurredAt: string;
}

export interface SyncedActivityRow {
  personId: string;
  type: SyncedActivityType;
  metadata: SyncedActivityMetadata;
}

export interface BuildSyncedActivityRowsInput {
  gmailMessageId: string;
  gmailThreadId: string;
  direction: "inbound" | "outbound";
  fromAddress: string;
  toAddresses: readonly string[];
  subject: string | null;
  sentAt: Date;
  isPlatformSent: boolean;
  /** `email_message.is_automatic` for this message. Required, not optional: a forgotten flag would fail open to `reply_received`. */
  isAutomatic: boolean;
  matches: readonly ClassifiedMatch[];
}

/** Never mutates `input` or `input.matches` — safe to call more than once with the same input (pure planner rule). */
export function buildSyncedActivityRows(input: BuildSyncedActivityRowsInput): SyncedActivityRow[] {
  if (input.isPlatformSent) return [];

  // Direction decides first: only INBOUND mail can be an auto-reply. Our own outbound is never reclassified.
  const type: SyncedActivityType =
    input.direction === "inbound" ? (input.isAutomatic ? "auto_reply_received" : "reply_received") : "email_sent";
  const occurredAt = input.sentAt.toISOString();
  const addressField = input.direction === "inbound" ? { from: input.fromAddress } : { to: [...input.toAddresses] };

  return input.matches.map((match) => ({
    personId: match.personId,
    type,
    metadata: {
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      subject: input.subject,
      ...addressField,
      matchedEmail: match.matchedEmail,
      matchConfidence: match.matchConfidence,
      source: "gmail_sync",
      occurredAt,
    },
  }));
}

/**
 * Natural (person, Gmail message) identity for a synced activity row —
 * documents and tests the uniqueness this design relies on. Not a DB
 * constraint: the actual idempotency guarantee is `email_message`'s
 * `unique(bd_id, gmail_message_id)` (syncQueries.ts), which ensures this
 * planner only ever runs once per message.
 */
export function syncedActivityIdempotencyKey(row: { personId: string; metadata: { gmailMessageId: string } }): string {
  return `${row.personId}:${row.metadata.gmailMessageId}`;
}
