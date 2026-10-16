/**
 * Pure half of the admin's inline conversation read (adminInlineConversations.ts
 * is the DB half): shapes the capped, newest-first rows into the two maps the
 * contact timeline renders from. No `@/db` import, so the client Timeline can
 * share the key builder with the producer.
 */
import type { TimelineEntry } from "@/lib/activity/timelineEntry";
import type { ThreadMessageBody } from "@/lib/gmail/threadMessages";

export interface InlineRow {
  kind: "email" | "linkedin";
  bdId: string;
  /** Gmail thread id for mail, conversation id for LinkedIn. */
  group: string;
  /** Gmail message id for mail, message id for LinkedIn. */
  ref: string;
  at: Date;
  /** Sender name for LinkedIn, the mailbox owner's name for mail. */
  who: string | null;
  body: string | null;
  truncated: boolean;
  /** Mail only (null for LinkedIn): "inbound" | "outbound". */
  direction: string | null;
  subject: string | null;
  /** Mail only: the recipients ("a, b") of an outbound message, the sender of an inbound one. */
  addr: string | null;
  /** Mail only: no `activity` row carries this message, so the timeline cannot list it by itself. */
  orphan: boolean;
}

/** A synced message with no activity row, shaped to be listed in the timeline. */
export interface InlineMail {
  bdId: string;
  bdName: string | null;
  gmailThreadId: string;
  gmailMessageId: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  addr: string | null;
  sentAt: Date;
}

export interface InlineLinkedinMessage {
  id: string;
  senderName: string | null;
  sentAt: Date;
  content: string;
  truncated: boolean;
}

export interface AdminInlineConversations {
  /** gmailThreadId -> gmailMessageId -> body (the shape the BD's own expanded thread uses). */
  emailBodies: Record<string, Record<string, ThreadMessageBody>>;
  /** bdId -> that BD's messages with this contact, oldest first. */
  linkedin: Record<string, InlineLinkedinMessage[]>;
  /** Synced messages no activity row covers (their bodies are in `emailBodies`), oldest first. */
  unlistedMail: InlineMail[];
  /** True when older rows were left out to stay under the row cap. */
  capped: boolean;
}

export const EMPTY_INLINE_CONVERSATIONS: AdminInlineConversations = { emailBodies: {}, linkedin: {}, unlistedMail: [], capped: false };

/** The one reader of `emailBodies`; groupInlineRows is its only writer. */
export function inlineEmailBody(
  bodies: AdminInlineConversations["emailBodies"],
  gmailThreadId: string,
  gmailMessageId: string,
): ThreadMessageBody | undefined {
  return bodies[gmailThreadId]?.[gmailMessageId];
}

/** `rows` arrive newest first; at most `limit` are used and `capped` says whether any were left out. */
export function groupInlineRows(rows: readonly InlineRow[], limit: number): AdminInlineConversations {
  const used = rows.slice(0, limit);
  const emailBodies: AdminInlineConversations["emailBodies"] = {};
  const linkedin: AdminInlineConversations["linkedin"] = {};
  const unlistedMail: InlineMail[] = [];
  for (const r of used) {
    if (r.kind === "email") {
      (emailBodies[r.group] ??= {})[r.ref] = { gmailMessageId: r.ref, bodyText: r.body, bodyTruncated: r.truncated };
      if (r.orphan) {
        unlistedMail.unshift({
          bdId: r.bdId, bdName: r.who, gmailThreadId: r.group, gmailMessageId: r.ref,
          direction: r.direction === "inbound" ? "inbound" : "outbound", subject: r.subject, addr: r.addr, sentAt: r.at,
        });
      }
    } else {
      (linkedin[r.bdId] ??= []).unshift({ id: r.ref, senderName: r.who, sentAt: r.at, content: r.body ?? "", truncated: r.truncated });
    }
  }
  return { emailBodies, linkedin, unlistedMail, capped: rows.length > limit };
}

/** True only when there is nothing at all to list: unlisted mail is content too. */
export function isTimelineEmpty(counts: { entries: number; upcoming: number; unlisted: number }): boolean {
  return counts.entries === 0 && counts.upcoming === 0 && counts.unlisted === 0;
}

/** The timeline entry an unlisted message is rendered as, in the same shape the sync writes (buildSyncedActivityRows). */
export function unlistedMailToEntry(m: InlineMail): TimelineEntry {
  const outbound = m.direction === "outbound";
  return {
    id: `mail-${m.gmailMessageId}`,
    type: outbound ? "email_sent" : "reply_received",
    createdAt: m.sentAt,
    at: m.sentAt,
    actorBdId: m.bdId,
    actorName: m.bdName,
    visible: true,
    metadata: {
      gmailMessageId: m.gmailMessageId,
      gmailThreadId: m.gmailThreadId,
      subject: m.subject,
      source: "gmail_sync",
      ...(outbound ? { to: m.addr ? m.addr.split(", ") : [] } : { from: m.addr }),
    },
  };
}
