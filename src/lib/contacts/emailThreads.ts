/**
 * Groups `email_sent`/`reply_received` activity entries by
 * `metadata.gmailThreadId` into one "thread" card (mockup-port r08;
 * contact-record.html:116-123's "Hilo de correo · Squads nearshore ... · 3
 * mensajes" card; email-sync.html:151-175 extends this to a synced reply
 * sharing the same thread). Pure — no DB.
 *
 * A row with no `gmailThreadId` (or any other activity type) passes through
 * untouched — only real Gmail threads with 2+ messages (sent and/or
 * received) get grouped; a lone message still renders as today (one plain
 * card), matching the mockup's OWN thread example only having a badge when
 * there is more than one message.
 */
const THREADABLE_TYPES = new Set(["email_sent", "reply_received", "auto_reply_received"]);
export interface EmailThreadableEntry {
  id: string;
  type: string;
  createdAt: Date;
  /**
   * Effective time (TimelineEntry.at): `metadata.occurredAt` for synced mail,
   * `created_at` only as the fallback. Thread order and `latestAt` use THIS,
   * never `createdAt`: the Gmail sync writes every row of a backfill with the
   * time the sync ran, a year or more after the mail was sent.
   */
  at: Date;
  metadata: Record<string, unknown> | null;
  visible: boolean;
}

export interface EmailThreadGroup<T extends EmailThreadableEntry> {
  threadId: string;
  // Oldest-first, matching the mockup's own thread reading order.
  messages: T[];
  /** Effective time of the NEWEST message: the thread card is dated and bucketed as of its latest mail. */
  latestAt: Date;
  visible: boolean;
}

export type ThreadedEntry<T extends EmailThreadableEntry> =
  | { kind: "single"; entry: T }
  | { kind: "thread"; group: EmailThreadGroup<T> };

function threadIdOf(entry: EmailThreadableEntry): string | null {
  if (!THREADABLE_TYPES.has(entry.type) || !entry.metadata) return null;
  const id = entry.metadata.gmailThreadId;
  return typeof id === "string" && id ? id : null;
}

export function groupEmailThreads<T extends EmailThreadableEntry>(entries: readonly T[]): ThreadedEntry<T>[] {
  const byThread = new Map<string, T[]>();
  const singles: T[] = [];

  for (const entry of entries) {
    const threadId = threadIdOf(entry);
    if (!threadId) {
      singles.push(entry);
      continue;
    }
    const existing = byThread.get(threadId);
    if (existing) existing.push(entry);
    else byThread.set(threadId, [entry]);
  }

  const result: ThreadedEntry<T>[] = [];
  for (const entry of singles) result.push({ kind: "single", entry });

  for (const [threadId, messages] of byThread) {
    if (messages.length < 2) {
      result.push({ kind: "single", entry: messages[0] });
      continue;
    }
    const sorted = [...messages].sort((a, b) => a.at.getTime() - b.at.getTime());
    result.push({
      kind: "thread",
      group: {
        threadId,
        messages: sorted,
        latestAt: sorted[sorted.length - 1].at,
        visible: sorted.some((m) => m.visible),
      },
    });
  }

  return result;
}

/**
 * The synthetic timeline entry a thread card is grouped under, carrying the
 * thread's EFFECTIVE latest time — never a database `created_at`, which for
 * synced mail is when the sync ran (see effectiveActivityTime.ts).
 *
 * It states that time EXPLICITLY in `metadata.occurredAt`, the field the shared
 * effective-time rule already reads for an `email_sent` row, instead of leaning
 * on that rule's fallback to `createdAt`. The fallback would work today, but
 * only through two coincidences at once: `email_sent` staying in
 * OCCURRED_AT_ACTIVITY_TYPES, and this entry never gaining an `occurredAt` of
 * its own. Break either and the card silently goes back to showing the sync
 * date — a bug this codebase has now shipped twice. `createdAt` carries the
 * same value so the two can never disagree, and
 * `tests/unit/emailThreads.test.ts` pins the resulting effective time rather
 * than the mechanism that produces it.
 */
export function threadGroupToTimelineEntry<T extends EmailThreadableEntry>(group: EmailThreadGroup<T>) {
  return {
    id: `thread-${group.threadId}`,
    type: "email_sent",
    createdAt: group.latestAt,
    metadata: { isThread: true, occurredAt: group.latestAt.toISOString() } as Record<string, unknown>,
    actorBdId: null,
    actorName: null,
    visible: group.visible,
  };
}

/**
 * "Deducido" badge (email-sync.html:180; README decision 1 — reuses
 * `.badge-probable`, the same class/color the contacts table already uses
 * for a `pattern_inferred` email match). A thread is "Deducido" if ANY of
 * its messages matched through an inferred address — the badge is a
 * caution about the MATCH, not about every individual message, so one
 * inferred-matched message is enough to flag the whole thread.
 */
export function isInferredThread<T extends EmailThreadableEntry>(group: EmailThreadGroup<T>): boolean {
  return group.messages.some((m) => m.metadata?.matchConfidence === "inferred");
}

/**
 * "Otra casilla" badge. A thread is flagged if ANY of its messages was
 * attributed to this Contact through the thread (`matchConfidence ===
 * "thread"`: a reply that came from an address we do NOT hold, assigned
 * because it arrived in a thread we wrote to). The caution is about the
 * SENDER's identity, not the address (which is real), so it is deliberately
 * different from `isInferredThread`. It is thread-level and independent of
 * which message is latest: once the BD replies, the latest message is an
 * outbound one with the held address, and a latest-message check would drop
 * the only hint that the earlier reply came from an unknown mailbox.
 */
export function isThreadAttributedThread<T extends EmailThreadableEntry>(group: EmailThreadGroup<T>): boolean {
  return group.messages.some((m) => m.metadata?.matchConfidence === "thread");
}

export interface ThreadContextSummary {
  /** The counterpart address this thread matched on, or `null` if no message carries one (should be rare — every synced message has `matchedEmail`). */
  matchedEmail: string | null;
  /** The LATEST message's direction — "outbound" for `email_sent`, "inbound" for `reply_received`. */
  direction: "outbound" | "inbound";
}

/**
 * Contextual summary line (email-sync.html:180: "Con d.salazar@despegar.com
 * Deducido · Diego Salazar · saliente" — mockup-fidelity fix, 2026-10-01,
 * replacing the generic "Sincronizado automáticamente desde Gmail." intro).
 * Reads off the thread's LATEST (most recent) message — `messages` is
 * sorted oldest-first, so that's simply the last element — matching the
 * mockup's own single-message thread example, which describes only that
 * one message's address/direction, not every message in the thread.
 */
export function threadContextSummary<T extends EmailThreadableEntry>(group: EmailThreadGroup<T>): ThreadContextSummary {
  const latest = group.messages[group.messages.length - 1];
  const matchedEmail = typeof latest?.metadata?.matchedEmail === "string" ? latest.metadata.matchedEmail : null;
  const direction: ThreadContextSummary["direction"] =
    latest?.type === "reply_received" || latest?.type === "auto_reply_received" ? "inbound" : "outbound";
  return { matchedEmail, direction };
}
