"use server";

/**
 * On-demand thread body loader for the "Correos" timeline pill's expanded
 * thread card (email-sync.html screen 1; task brief §1). Called from the
 * client once, the first time a thread is expanded — see Timeline.tsx's
 * `expandedThreadId` state — never during the record page's own render.
 */
import { unstable_rethrow } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getThreadForDisplay, type ThreadMessageBody } from "@/lib/gmail/threadMessages";
import { planThreadReply, replyView, type ReplyView } from "@/lib/gmail/replyThread";
import { isUuid } from "@/lib/uuid";

export type GetThreadBodiesResult = { ok: true; messages: ThreadMessageBody[]; reply: ReplyView } | { ok: false };

export async function getThreadBodiesAction(personId: string, gmailThreadId: string): Promise<GetThreadBodiesResult> {
  try {
    if (!isUuid(personId) || !gmailThreadId) return { ok: false };
    const me = await getCurrentBd();
    const { bodies, replySource } = await getThreadForDisplay(me.id, personId, gmailThreadId);
    return { ok: true, messages: bodies, reply: replyView(planThreadReply(replySource)) };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[contacts] getThreadBodiesAction failed", err);
    return { ok: false };
  }
}
