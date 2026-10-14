/**
 * Sequence member state machine, encoding the `sequence-approval` table.
 * Pure: callers decide what to do with a rejection; nothing here is ignored
 * silently (`assertTransition` throws).
 */

export const MEMBER_STATES = [
  "drafted",
  "approved",
  "sent",
  "replied",
  "no_reply",
  "discarded",
] as const;
export type MemberState = (typeof MEMBER_STATES)[number];

export type MemberTrigger =
  | "approve"
  | "cancel"
  | "edit"
  | "regenerate"
  | "release_step1"
  | "release_step2"
  | "genuine_reply"
  | "discard"
  | "readmit"
  | "opt_out"
  // Out-of-office and other automatic replies. Deliberately absent from every
  // rule below: an auto-reply must never move a member.
  | "auto_reply";

export type TransitionContext = {
  /** Why the member was discarded; only consulted for `readmit`. */
  discardReason?: string | null;
};

type Rule = { from: MemberState[]; to: MemberState };

const RULES: Record<Exclude<MemberTrigger, "auto_reply">, Rule> = {
  approve: { from: ["drafted"], to: "approved" },
  cancel: { from: ["approved"], to: "drafted" },
  edit: { from: ["approved"], to: "drafted" },
  regenerate: { from: ["approved"], to: "drafted" },
  release_step1: { from: ["approved"], to: "sent" },
  release_step2: { from: ["sent"], to: "no_reply" },
  genuine_reply: { from: ["sent", "no_reply"], to: "replied" },
  discard: { from: ["drafted", "approved"], to: "discarded" },
  readmit: { from: ["discarded"], to: "drafted" },
  // Unsubscribe reaches every live membership, including `replied`: that member
  // is a warm lead in Seguimientos and a BD could otherwise email them by hand.
  opt_out: { from: ["drafted", "approved", "sent", "no_reply", "replied"], to: "discarded" },
};

export function canTransition(
  from: MemberState,
  to: MemberState,
  trigger: MemberTrigger,
  context: TransitionContext = {},
): boolean {
  if (trigger === "auto_reply") return false;
  const rule = RULES[trigger];
  if (!rule.from.includes(from) || rule.to !== to) return false;
  // An opted-out address must never re-enter a sequence.
  if (trigger === "readmit" && context.discardReason === "opt_out") return false;
  return true;
}

export function assertTransition(
  from: MemberState,
  to: MemberState,
  trigger: MemberTrigger,
  context: TransitionContext = {},
): void {
  if (!canTransition(from, to, trigger, context)) {
    throw new Error(`Illegal sequence member transition: ${from} -> ${to} via ${trigger}`);
  }
}
