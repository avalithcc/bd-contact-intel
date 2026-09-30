"use server";

/**
 * On-demand full message history for the viewing BD's OWN LinkedIn
 * connection (owner decision 2026-09-30: right panel "Historial de
 * conversaciones" card, contact-record.html:172-178). Called from
 * OwnConversationHistory.tsx once, the first time it's expanded — never
 * during the record page's own render (PERFORMANCE.md).
 */
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getOwnConversationMessages, type OwnConversationMessage } from "@/lib/activity/getOwnConversationMessages";
import { isUuid } from "@/lib/uuid";

export type GetOwnConversationMessagesResult = { ok: true; messages: OwnConversationMessage[] } | { ok: false };

export async function getOwnConversationMessagesAction(personId: string): Promise<GetOwnConversationMessagesResult> {
  try {
    if (!isUuid(personId)) return { ok: false };
    // `me.id` — never a client-supplied bdId — is the ONLY scope this reads
    // (see getOwnConversationMessages's doc comment): a BD can only ever
    // expand their OWN connection this way, no matter what this action is
    // called with.
    const me = await getCurrentBd();
    const messages = await getOwnConversationMessages(me.id, personId);
    return { ok: true, messages };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[contacts] getOwnConversationMessagesAction failed", err);
    return { ok: false };
  }
}
