/**
 * What an edit does to a draft's review and approval, as one pure decision (the caller supplies the clock).
 *
 * Writing the text is reading it, so an editor does not have to reopen their own edit: an unreviewed draft becomes reviewed
 * by the editor, and the editor's own earlier review is refreshed. A review by SOMEONE ELSE (or by an unknown reviewer) was
 * a review of different text and is cleared. Approval and schedule are cleared in every case: an approved email whose text
 * changed has to be approved again. Regenerate does not use this; it clears the review unconditionally.
 */
export type ReviewState = { reviewedAt: Date | null; reviewedByBdId: string | null };

export type EditResetColumns = {
  reviewedAt: Date | null;
  reviewedByBdId: string | null;
  approvedAt: null;
  approvedByBdId: null;
  scheduledFor: null;
};

export function reviewAfterEdit(current: ReviewState, editorBdId: string, now: Date): EditResetColumns {
  const unreviewed = current.reviewedAt === null;
  const keeps = unreviewed || current.reviewedByBdId === editorBdId;
  return {
    reviewedAt: keeps ? new Date(now.getTime()) : null,
    reviewedByBdId: keeps ? editorBdId : null,
    approvedAt: null,
    approvedByBdId: null,
    scheduledFor: null,
  };
}
