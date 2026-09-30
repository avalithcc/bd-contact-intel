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
