/**
 * Groups `getConversationForAdmin`'s `syncedEmails` by `gmailThreadId` into
 * one "hilo de correo" card per thread (admin-conversation-access mockup,
 * "Correos sincronizados" section, admin-conversation.html:213-228) — the
 * same grouping key `groupEmailThreads` uses for the BD's own timeline
 * (src/lib/contacts/emailThreads.ts), applied here to the admin bypass's
 * already-unredacted rows instead. Pure — no DB.
 *
 * Unlike `groupEmailThreads`, every `gmailThreadId` becomes its own group
 * here regardless of message count: `getConversationForAdmin` never returns
 * more than one BD's synced mail for this Contact, so a lone message is still
 * "the thread with that BD", not a a separate rendering case to special-case.
 */
import type { AdminSyncedEmailMessage } from "@/lib/activity/getConversationForAdmin";

export interface SyncedEmailThreadGroup {
  threadId: string;
  // The oldest message in the thread that actually has one — a reply's
  // subject is often "Re: ..." of the same conversation, so the original
  // (oldest) subject is the more useful card title.
  subject: string | null;
  latestAt: Date;
  // Oldest-first, matching the mockup's own reading order.
  messages: AdminSyncedEmailMessage[];
}

export function groupSyncedEmailThreads(messages: readonly AdminSyncedEmailMessage[]): SyncedEmailThreadGroup[] {
  const byThread = new Map<string, AdminSyncedEmailMessage[]>();
  for (const m of messages) {
    const existing = byThread.get(m.gmailThreadId);
    if (existing) existing.push(m);
    else byThread.set(m.gmailThreadId, [m]);
  }

  const groups: SyncedEmailThreadGroup[] = [];
  for (const [threadId, group] of byThread) {
    const sorted = [...group].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const subject = sorted.find((m) => m.subject)?.subject ?? null;
    groups.push({ threadId, subject, latestAt: sorted[sorted.length - 1].sentAt, messages: sorted });
  }

  return groups.sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}
