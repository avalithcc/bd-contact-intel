// NOTHING in this file may import the database or any node builtin: QuickActions.tsx is a client component and
// imports followUpToast from here. A db import pulled node:fs into the client bundle and only `next build` caught
// it - lint and 6087 unit tests all passed. The server-side owner lookup lives in ownerLookup.ts for that reason.
import { FOLLOW_UP_ENTRY_DAYS } from "@/lib/followUp/cycle";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a contact emailed by hand comes back to the sender's follow-up queue.
 * `earliest` is a FLOOR, not a promise: the daily cap can push a contact later. `excluded` means the sender's role-group deny
 * list covers the contact, so it never enters the queue. A null role group is "not classified yet", never excluded (same rule as
 * fuqRoleGroupAllowedSql in candidateQuery.ts).
 */
/**
 * Whose queue, and when. The follow-up queue is built per CONTACT OWNER (candidateQuery.ts: `where fuq_owner_bd_id =
 * $bdId`), and the role-group deny list applied to it is that owner's, not the sender's. 330 of 2,339 manual sends -
 * 1 in 7 - go to a contact owned by someone else, so reporting the sender's own list would be wrong that often, and
 * "vuelve a TUS seguimientos" would name the wrong queue.
 */
export type FollowUpReturn =
  | { kind: "earliest"; at: Date; mine: boolean; ownerName: string | null }
  | { kind: "excluded"; mine: boolean; ownerName: string | null }
  | { kind: "unowned" };

/**
 * `owner` is the CONTACT's owner, never the sender: that is the BD whose queue this enters and whose deny list decides
 * it. A contact with no owner enters nobody's queue - candidateQuery requires `person.owner_bd_id is not null` - so it
 * gets its own answer instead of a date that will never arrive.
 */
export function followUpReturn(
  sentAt: Date,
  roleGroup: string | null,
  owner: { bdId: string | null; name: string | null; excludedRoleGroups: readonly string[] },
  senderBdId: string,
): FollowUpReturn {
  if (owner.bdId === null) return { kind: "unowned" };
  const mine = owner.bdId === senderBdId;
  const ownerName = mine ? null : owner.name;
  // A null role group is "unclassified", not a group, so it can never match a deny list entry.
  if (roleGroup !== null && owner.excludedRoleGroups.includes(roleGroup)) return { kind: "excluded", mine, ownerName };
  return { kind: "earliest", at: new Date(sentAt.getTime() + FOLLOW_UP_ENTRY_DAYS * DAY_MS), mine, ownerName };
}

/** Wire shape: a Date does not survive as-is in every transport, so the action returns the ISO string. */
export type FollowUpReturnWire =
  | { kind: "earliest"; atIso: string; mine: boolean; ownerName: string | null }
  | { kind: "excluded"; mine: boolean; ownerName: string | null }
  | { kind: "unowned" };

export function followUpReturnToWire(r: FollowUpReturn): FollowUpReturnWire {
  return r.kind === "earliest" ? { kind: "earliest", atIso: r.at.toISOString(), mine: r.mine, ownerName: r.ownerName } : r;
}


/**
 * What the send confirmation says. Pure, so every branch is pinned by a test instead of by opening the screen.
 *
 * It never says "tus seguimientos" for a contact someone else owns: the queue belongs to the owner and applies the
 * owner's deny list, and 1 in 7 manual sends crosses that line. "A partir del", not "el": the date is the earliest
 * day the contact becomes eligible, and a capped day (FOLLOW_UP_DAILY_CAP) can push it later.
 */
export function followUpToast(
  r: FollowUpReturnWire,
  l: {
    toastEmailSent: string;
    toastEmailSentReturns: string;
    toastEmailSentReturnsOwner: string;
    toastEmailSentExcluded: string;
    toastEmailSentExcludedOwner: string;
  },
  fmt: (iso: string) => string,
): string {
  const owner = r.kind === "unowned" ? null : r.ownerName;
  if (r.kind === "unowned") return l.toastEmailSent;
  if (r.kind === "excluded") {
    return r.mine || !owner
      ? l.toastEmailSentExcluded
      : l.toastEmailSentExcludedOwner.replace("{owner}", owner);
  }
  return r.mine || !owner
    ? l.toastEmailSentReturns.replace("{date}", fmt(r.atIso))
    : l.toastEmailSentReturnsOwner.replace("{date}", fmt(r.atIso)).replace("{owner}", owner);
}
