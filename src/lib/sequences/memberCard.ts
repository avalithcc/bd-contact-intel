/**
 * Maps one member to what its card shows: badge, meta-line kind, and the action set (sequence-detail-view "Member cards
 * per state"). Pure and string-free: it returns keys, and the component words them through the `sequences` dictionary,
 * so the state table is pinned by a test while the copy stays in one place.
 *
 * Decisions encoded here rather than in JSX:
 *  - "Recordatorio hoy" is a presentation of `sent`, not a state: a reminder is due once its Miami calendar day is
 *    reached (an overdue one included), judged in Miami time because that is when the runner releases it.
 *  - The hold reason rides along untouched. It is the PR 9 `HoldReason`, so a new reason cannot be added without the
 *    dictionary (typed `Record<HoldReason, string>`) saying how to word it.
 *  - A replied card offers neither approve nor reminder: the sequence stopped for that Contact.
 *  - "Reincorporar" is hidden for an opt-out, asking the same state machine the write path asks, so the button can
 *    never offer a move the action would refuse.
 */
import { miamiCalendarDate } from "./miamiTime";
import { canTransition, type MemberState } from "./memberState";
import { DRAFT_HOLD_REASONS, type HoldReason } from "./preSendChecks";

export type CardKind = "draft" | "noDraft" | "approved" | "scheduled" | "sent" | "reminderToday" | "noReply" | "replied" | "discarded";
export type CardTone = "info" | "brand" | "contacted" | "warn" | "replied" | "discarded" | "neutral";
export type CardActionId =
  | "generate" | "reviewDraft" | "approve" | "viewEmail" | "cancel" | "viewSent" | "advanceReminder" | "reviewReminder"
  | "viewDraft" | "viewReminder" | "change" | "sendNow" | "cancelSchedule" | "openConversation" | "readmit" | "regenerate" | "openContact" | "remove" | "optOut";
export type CardAction = { id: CardActionId; style: "primary" | "secondary" | "ghost" };

export type CardFacts = {
  state: MemberState;
  /** A step 1 draft exists. */
  hasDraft: boolean;
  holdReason: HoldReason | null;
  reminderDueAt: Date | null;
  florida: boolean;
  discardReason: string | null;
  /** Approved only: the BD chose the moment ("scheduled") or it follows the cadence (approvedMoment.ts). Unknown reads as the cadence. */
  approvedMode?: "cadence" | "scheduled";
};

export type CardView = {
  kind: CardKind;
  tone: CardTone;
  florida: boolean;
  holdReason: HoldReason | null;
  actions: CardAction[];
  /** Overflow-menu items, in order. */
  menu: CardActionId[];
};

const act = (id: CardActionId, style: CardAction["style"]): CardAction => ({ id, style });

function reminderDue(f: CardFacts, now: Date): boolean {
  return f.state === "sent" && f.reminderDueAt !== null && miamiCalendarDate(f.reminderDueAt) <= miamiCalendarDate(now);
}

/** The same ids, read-only: where a write path says "Revisar" a foreign Sequence says "Ver", and nothing that writes survives. */
const READ_ONLY_ACTIONS: Partial<Record<CardActionId, CardActionId>> = { reviewDraft: "viewDraft", reviewReminder: "viewReminder", viewEmail: "viewEmail", viewSent: "viewSent", openConversation: "openConversation" };

function readOnlyView(card: CardView): CardView {
  const actions = card.actions.flatMap((a) => (READ_ONLY_ACTIONS[a.id] ? [{ ...a, id: READ_ONLY_ACTIONS[a.id]! }] : []));
  return { ...card, actions, menu: card.menu.filter((id) => id === "openContact") };
}

/** `readOnly`: the viewer is not the owner (an admin); see readOnly.ts. */
export function mapMemberCard(f: CardFacts, now: Date, readOnly = false): CardView {
  const card = mapOwnCard(f, now);
  return readOnly ? readOnlyView(card) : card;
}

function mapOwnCard(f: CardFacts, now: Date): CardView {
  const base = { florida: false, holdReason: f.holdReason, menu: [] as CardActionId[] };
  switch (f.state) {
    case "drafted":
      if (!f.hasDraft) return { ...base, kind: "noDraft", tone: "neutral", actions: [act("generate", "primary")], menu: ["openContact", "remove"] };
      // A draft card hides only the holds about the DRAFT (it is being fixed: DRAFT_HOLD_REASONS; the audience alert covers the no-audience case). A send-side hold stays visible.
      return { ...base, holdReason: f.holdReason && DRAFT_HOLD_REASONS.includes(f.holdReason) ? null : f.holdReason, kind: "draft", tone: "info", florida: f.florida, actions: [act("reviewDraft", "secondary"), act("approve", "primary")], menu: ["regenerate", "openContact", "remove"] };
    case "approved":
      // "Cambiar" and "Enviar ahora" are on both approved cards (send-now-or-schedule); only the cancel wording differs.
      return {
        ...base,
        kind: f.approvedMode === "scheduled" ? "scheduled" : "approved",
        tone: "brand",
        actions: [act("viewEmail", "ghost"), act("change", "secondary"), act("sendNow", "secondary"), act(f.approvedMode === "scheduled" ? "cancelSchedule" : "cancel", "ghost")],
      };
    case "sent":
      return reminderDue(f, now)
        ? { ...base, kind: "reminderToday", tone: "warn", actions: [act("reviewReminder", "secondary"), act("approve", "primary")] }
        : { ...base, kind: "sent", tone: "contacted", actions: [act("viewSent", "ghost"), act("advanceReminder", "secondary")] };
    case "no_reply":
      return { ...base, kind: "noReply", tone: "contacted", actions: [act("viewSent", "ghost")] };
    case "replied":
      // "No contactar" is in the menu, NOT only behind the detected-phrase prompt: sequence-compliance says the member
      // card MUST offer it and that phrase detection "MUST NOT be the only path to suppression". Someone who asks to be
      // removed in words the detector misses still has to be removable.
      return { ...base, kind: "replied", tone: "replied", actions: [act("openConversation", "primary")], menu: ["optOut", "openContact"] };
    case "discarded":
      return { ...base, kind: "discarded", tone: "discarded", actions: canTransition("discarded", "drafted", "readmit", { discardReason: f.discardReason }) ? [act("readmit", "ghost")] : [] };
  }
}

export type DiscardedView = {
  badge: "discarded" | "bounced" | "optedOut";
  badgeClass: "badge-discarded" | "badge-danger";
  /** A bounce or opt-out on a member this Sequence never wrote to: the address was already burned elsewhere. */
  neverSent: boolean;
  /** Which meta line the card words. `removedAuto` is a discard nobody made by hand (`discarded_by_bd_id` null). */
  meta: "bounced" | "bouncedUnsent" | "optedOut" | "optedOutUnsent" | "removedBy" | "removedAuto";
};

/** Bounce and opt-out keep the labels approved in contact-bounce.html and baja-opciones.html; every other reason stays "Descartado". */
export function discardedView(f: { discardReason: string | null; sentAt: Date | null; discardedByBdId: string | null }): DiscardedView {
  const unsent = f.sentAt === null;
  if (f.discardReason === "bounce") return { badge: "bounced", badgeClass: "badge-danger", neverSent: unsent, meta: unsent ? "bouncedUnsent" : "bounced" };
  if (f.discardReason === "opt_out") return { badge: "optedOut", badgeClass: "badge-discarded", neverSent: unsent, meta: unsent ? "optedOutUnsent" : "optedOut" };
  return { badge: "discarded", badgeClass: "badge-discarded", neverSent: false, meta: f.discardedByBdId ? "removedBy" : "removedAuto" };
}
