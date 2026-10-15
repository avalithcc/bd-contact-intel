// Pure planner: an inbound reply from the exact address we hold proves that mailbox works,
// so the Contact's email_status becomes 'verified'. No IO; inputs are never mutated.
//
// The decision is keyed on the ADDRESS comparison (sender === person.email_normalized), NOT on
// email_message_person.match_confidence. That column is provenance ('inferred' when the address
// came from a pattern guess), not match quality: a reply that arrives FROM the exact stored
// address is proof of delivery whoever guessed it. So an inferred-source Contact is promoted
// too, and email_source is deliberately left alone (the reply proves the address works, not
// where it came from). Note isReachable still refuses pattern_inferred for Sequences.
//
// No new activity type: the sync already writes one `reply_received` activity for this
// message, and a second row would double-count the touch.

import { GENERIC_LOCAL_PARTS } from "@/lib/identity/nameFromEmailBackfill";
import type { NewPerson, NewPersonPropertyHistory, Person } from "@/db/schema";

/** person_property_history.source for a status flipped by an inbound reply. */
export const INBOUND_REPLY_SOURCE = "inbound_reply";

export type ReplyVerifiablePerson = Pick<Person, "id" | "emailNormalized" | "emailStatus" | "mergedIntoId"> & {
  /** Live (non-merged) Contacts holding this email_normalized, the Contact itself included. */
  liveHolders: number;
};

/**
 * Shared / role mailbox by name, with the owner-approved GENERIC_LOCAL_PARTS and the same
 * semantics as nameFromEmailBackfill: a WHOLE token matches, or the whole local part matches
 * once separators are stripped (info@, ventas@, no-reply@). A "+tag" is not part of the name.
 */
export function isGenericMailbox(email: string): boolean {
  const local = (email.split("@")[0] ?? "").split("+")[0]!.toLowerCase();
  const tokens = local.split(/[._-]+/).filter(Boolean);
  return tokens.some((t) => GENERIC_LOCAL_PARTS.has(t)) || GENERIC_LOCAL_PARTS.has(tokens.join(""));
}

export interface InboundReplyMessage {
  direction: "inbound" | "outbound";
  fromAddress: string;
}

export type InboundReplyHistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;

export interface InboundReplyPlan {
  personUpdate: Pick<Partial<NewPerson>, "emailStatus"> | null;
  historyRows: InboundReplyHistoryRow[];
}

const NOTHING: InboundReplyPlan = { personUpdate: null, historyRows: [] };

export function planInboundReplyVerification(person: ReplyVerifiablePerson, message: InboundReplyMessage): InboundReplyPlan {
  if (message.direction !== "inbound" || person.mergedIntoId) return NOTHING;
  if (person.emailStatus !== "probable" && person.emailStatus !== "none") return NOTHING;
  const held = person.emailNormalized;
  // 'verified' is an identity key, not a badge: resolve.ts merges automatically on a shared
  // verified email and duplicateTiering.ts bulk-merges pairs that are both verified. A reply
  // from a mailbox several people use (info@, or the same address on two records) would turn
  // it into a strong key and could fuse different people, so a shared address is never
  // promoted, whatever the reply proves. A refusal writes nothing: no update, no history row.
  if (held && (isGenericMailbox(held) || person.liveHolders > 1)) return NOTHING;
  if (!held || message.fromAddress.trim().toLowerCase() !== held) return NOTHING;
  return {
    personUpdate: { emailStatus: "verified" },
    historyRows: [
      { personId: person.id, property: "emailStatus", oldValue: person.emailStatus, newValue: "verified", changedByBdId: null, source: INBOUND_REPLY_SOURCE },
    ],
  };
}

/** A planned promotion plus the exact address it was decided on, so the write can re-check it. */
export interface InboundReplyPromotion {
  historyRow: InboundReplyHistoryRow;
  address: string;
}

/** One promotion per Contact however many replies arrive in the batch. */
export function planInboundReplyBatch(entries: readonly { person: ReplyVerifiablePerson; message: InboundReplyMessage }[]): InboundReplyPromotion[] {
  const out = new Map<string, InboundReplyPromotion>();
  for (const { person, message } of entries) {
    if (out.has(person.id)) continue;
    const [historyRow] = planInboundReplyVerification(person, message).historyRows;
    // A promoted Contact matched its stored address, so emailNormalized IS the address.
    if (historyRow) out.set(person.id, { historyRow, address: person.emailNormalized! });
  }
  return [...out.values()];
}
