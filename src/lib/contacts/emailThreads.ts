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
const THREADABLE_TYPES = new Set(["email_sent", "reply_received"]);
export interface EmailThreadableEntry {
  id: string;
  type: string;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
  visible: boolean;
}

export interface EmailThreadGroup<T extends EmailThreadableEntry> {
  threadId: string;
  // Oldest-first, matching the mockup's own thread reading order.
  messages: T[];
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
    const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    result.push({
      kind: "thread",
      group: {
        threadId,
        messages: sorted,
        latestAt: sorted[sorted.length - 1].createdAt,
        visible: sorted.some((m) => m.visible),
      },
    });
  }

  return result;
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
  const direction: ThreadContextSummary["direction"] = latest?.type === "reply_received" ? "inbound" : "outbound";
  return { matchedEmail, direction };
}
