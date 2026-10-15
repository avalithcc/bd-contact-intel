/**
 * View model for the Contact-record "Secuencias" block and the "No contactar" control (outreach-sequences 12.4). Pure
 * and string-free, like memberCard.ts: it returns keys and counts, the components word them.
 *
 * Decisions encoded here rather than in JSX:
 *  - `discarded` is split on `sentAt`, the only fact that separates "dropped before anything went out" from "dropped
 *    after the mail went out". A card must never say a mail was sent that never existed, or the reverse.
 *  - An opted-out membership is its own kind ("Pidió la baja"), because the reason, not the state, is what the BD needs.
 *  - The control targets ONE membership the viewer owns, because recordOptOutForMember refuses any other. Its effect is
 *    address-wide (every live membership, every Sequence, every BD): `ownLiveCount` is only the part the viewer can
 *    count, and the dialog says so instead of presenting it as the whole scope.
 *  - The advisory prompt is a hint: nothing in this module suppresses or discards anything.
 */
import type { OptOutResult } from "./optOutQueries";
import { OPT_OUT_DISCARD_REASON, planOptOutDiscards } from "./optOut";
import type { MemberState } from "./memberState";
import type { CardKind } from "./memberCard";

export type ContactMembership = {
  memberId: string;
  sequenceName: string;
  state: MemberState;
  /** Only the viewer's own memberships can be opted out through the action. */
  ownedByViewer: boolean;
  scheduledFor: Date | null;
  sentAt: Date | null;
  repliedAt: Date | null;
  discardedAt: Date | null;
  discardReason: string | null;
};

export type MembershipKind = "drafted" | "approved" | "sent" | "noReply" | "replied" | "discardedUnsent" | "discardedSent" | "optedOut";
export type MembershipTone = "info" | "brand" | "contacted" | "replied" | "discarded";
export type MembershipRow = { membership: ContactMembership; kind: MembershipKind; tone: MembershipTone };

export type ContactContextView = {
  rows: MembershipRow[];
  /** An opt-out is already on record for this Contact: the control is replaced by the recorded line. */
  optedOut: boolean;
  optOutMemberId: string | null;
  ownLiveCount: number;
};

function rowKind(m: ContactMembership): MembershipKind {
  switch (m.state) {
    case "drafted": return "drafted";
    case "approved": return "approved";
    case "sent": return "sent";
    case "no_reply": return "noReply";
    case "replied": return "replied";
    case "discarded":
      if (m.discardReason === OPT_OUT_DISCARD_REASON) return "optedOut";
      return m.sentAt ? "discardedSent" : "discardedUnsent";
  }
}

const TONES: Record<MembershipKind, MembershipTone> = {
  drafted: "info", approved: "brand", sent: "contacted", noReply: "contacted", replied: "replied",
  discardedUnsent: "discarded", discardedSent: "discarded", optedOut: "discarded",
};

export function contactContextView(memberships: readonly ContactMembership[]): ContactContextView {
  const rows = memberships.map((membership) => ({ membership, kind: rowKind(membership), tone: TONES[rowKind(membership)] }));
  const own = memberships.filter((m) => m.ownedByViewer);
  const live = new Set(planOptOutDiscards(own.map((m) => ({ id: m.memberId, state: m.state }))));
  const optedOut = rows.some((r) => r.kind === "optedOut");
  const target = own.find((m) => live.has(m.memberId)) ?? own[0] ?? null;
  return { rows, optedOut, optOutMemberId: optedOut ? null : (target?.memberId ?? null), ownLiveCount: live.size };
}

/** Advisory only: a replied card with a detected phrase. The address stays unsuppressed until the BD acts. */
export function showOptOutPrompt(kind: CardKind, phrase: string | null | undefined): boolean {
  return kind === "replied" && !!phrase;
}

export type OptOutErrorKey = "optOutErrorNotFound" | "optOutErrorNoEmail";
export function optOutErrorKey(error: Extract<OptOutResult, { ok: false }>["error"]): OptOutErrorKey {
  return error === "no_email" ? "optOutErrorNoEmail" : "optOutErrorNotFound";
}
