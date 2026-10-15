import type { CardActionId } from "@/lib/sequences/memberCard";

/**
 * What a control on the detail screen asks for. The components only report intent: the container that mounts them
 * (the go-live PR) decides whether it opens a dialog (PR 12) or calls an existing server action in actions.ts.
 */
export type DetailAction =
  | { type: "editSequence" | "generateMissing" | "approveReady" | "changeCadence" | "createNext" }
  | { type: CardActionId; memberId: string }
  /** Only asks to start: the confirmation is `OptOutDialog`, which states the scope before anything is recorded. */
  | { type: "optOut"; memberId: string };
export type OnAction = (action: DetailAction) => void;

/**
 * What the review dialog asks for. `save` and `approve` carry the text as it stands in the form: the container saves
 * it (saveSequenceDraft) and, for `approve`, approves only after that save succeeded, because an approval binds to the
 * exact content. `markReviewed` is reported once when a draft nobody opened is opened (markDraftReviewed).
 */
export type ReviewAction =
  | { type: "markReviewed" | "regenerate"; memberId: string; step: 1 | 2 }
  | { type: "save" | "approve"; memberId: string; step: 1 | 2; subject: string; body: string };
export type OnReviewAction = (action: ReviewAction) => void;

/** What the bulk bar asks for. `remove` only asks to start: the reason is collected by `RemoveReasonDialog`. */
export type BulkAction = { type: "regenerate" | "approve" | "remove"; memberIds: string[] };
export type OnBulkAction = (action: BulkAction) => void;

/** What the Contact-record block asks for. Same rule as `optOut` above: the container opens `OptOutDialog`, then calls recordOptOutForMember. */
export type ContactContextAction = { type: "optOut"; memberId: string };
export type OnContactContextAction = (action: ContactContextAction) => void;
