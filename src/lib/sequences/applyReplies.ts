/**
 * Which inbound mail moves a Sequence member to `replied` (task 10.5). Pure planning plus one orchestrator over two
 * ports; the SQL lives in replyQueries.ts. Not wired into the sync yet (task 10.6), so nothing calls it in production.
 *
 * A message counts for a member only when ALL of these hold:
 *  - it is inbound and not machine-generated (`automated`, the verdict of automatedMessage.ts: an out-of-office is
 *    never a reply, memberState.ts `auto_reply`);
 *  - it was not never-logged (classify already drops those from `matches`; checked again so the rule is local);
 *  - the member's Contact is a match with a confidence other than 'thread'. DECISION: a thread-attributed message
 *    came from an address we do NOT hold; someone in that thread answered, and we do not know it was the Contact.
 *    "A reply FROM the member's Contact" is therefore not proven, and the cost of guessing is asymmetric toward
 *    silence: a missed reply here can still be caught by the existing reply_received activity and the BD's own eyes,
 *    while a wrong `replied` withdraws the reminder of a person who never answered. It matches syncWriteCore, which
 *    already refuses to verify an address on a thread match;
 *  - it is dated strictly AFTER the member's step 1 send (`sent_at`), so history from before the send, a backfill of
 *    old mail, or a replay of the same message cannot move anyone;
 *  - the member is `sent` or `no_reply` (memberState.ts `genuine_reply`), the only states that have been sent to.
 * The earliest such message wins: an auto-reply followed by a human gives the HUMAN's time as `replied_at`.
 *
 * CROSS-BD BY DESIGN: a genuine reply from the Contact moves EVERY member of that Contact, whichever BD's mailbox saw
 * the mail and whichever BD owns the Sequence. The safe direction is to stop a reminder to someone who has answered us,
 * and nothing here sends or discloses anything. Because no BD decided it, the move is recorded as system-inferred: there
 * is no actor anywhere in this module and NO audit_log row (audit_log.actor_bd_id is NOT NULL, and naming the mailbox
 * owner would blame the wrong person). The durable record is `sequence_member.replied_at`, which only this code writes,
 * and the inbound email_message it points at by time.
 *
 * Nothing here touches the Seguimientos queue table (a test greps both modules): that queue is derived by its own code
 * from the unchanged reply_received activity.
 */
import type { ClassifiedMessage } from "@/lib/gmail/classify";
import { canTransition, MEMBER_STATES, type MemberState } from "./memberState";

export type ReplyMessage = Pick<ClassifiedMessage, "gmailMessageId" | "direction" | "sentAt" | "automated" | "neverLogged" | "matches">;

export interface ReplyMember {
  id: string;
  personId: string;
  state: string;
  sentAt: Date | null;
}

export interface ReplyUpdate {
  memberId: string;
  personId: string;
  repliedAt: Date;
  gmailMessageId: string;
}

export interface ReplyPorts {
  /** Members of these Contacts that have been sent to (state sent / no_reply, sent_at set). One read. */
  findMembers(personIds: readonly string[]): Promise<ReplyMember[]>;
  /** Applies the updates in one transaction and returns how many members actually moved. */
  applyReplies(updates: readonly ReplyUpdate[]): Promise<number>;
}

/** Genuine replies per Contact, oldest first. The ONE builder: the planner reads it and the orchestrator queries its keys. */
export function genuineRepliesByPerson(messages: readonly ReplyMessage[]): Map<string, { at: Date; gmailMessageId: string }[]> {
  const byPerson = new Map<string, { at: Date; gmailMessageId: string }[]>();
  for (const m of messages) {
    if (m.direction !== "inbound" || m.automated === true || m.neverLogged === true) continue;
    for (const match of m.matches) {
      if (match.matchConfidence === "thread") continue;
      const list = byPerson.get(match.personId) ?? [];
      list.push({ at: m.sentAt, gmailMessageId: m.gmailMessageId });
      byPerson.set(match.personId, list);
    }
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return byPerson;
}

const isMemberState = (state: string): state is MemberState => (MEMBER_STATES as readonly string[]).includes(state);

export function planSequenceReplies(messages: readonly ReplyMessage[], members: readonly ReplyMember[]): ReplyUpdate[] {
  const replies = genuineRepliesByPerson(messages);
  const updates: ReplyUpdate[] = [];
  for (const member of members) {
    if (member.sentAt === null || !isMemberState(member.state) || !canTransition(member.state, "replied", "genuine_reply")) continue;
    const first = replies.get(member.personId)?.find((r) => r.at.getTime() > member.sentAt!.getTime());
    if (first) updates.push({ memberId: member.id, personId: member.personId, repliedAt: first.at, gmailMessageId: first.gmailMessageId });
  }
  return updates;
}

export async function applySequenceReplies(messages: readonly ReplyMessage[], ports: ReplyPorts): Promise<{ replied: number }> {
  const personIds = [...genuineRepliesByPerson(messages).keys()];
  // No candidate Contact, no query: the live sync pays nothing for a batch without a possible reply.
  if (personIds.length === 0) return { replied: 0 };
  const updates = planSequenceReplies(messages, await ports.findMembers(personIds));
  if (updates.length === 0) return { replied: 0 };
  return { replied: await ports.applyReplies(updates) };
}
