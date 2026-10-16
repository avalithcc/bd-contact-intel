/**
 * The read-only rule for the Sequence detail screen. An admin reads every BD's Sequence; on one that is not theirs every
 * write control is ABSENT (not disabled). The server already refuses each write on a foreign Sequence (every action
 * filters by owner), so this rule only decides what the screen offers; it is never the boundary.
 */
export const isReadOnlyView = (viewerBdId: string, ownerBdId: string): boolean => viewerBdId !== ownerBdId;

/** The intents a read-only screen may still act on: opening a draft/email read-only and navigating to the Contact. */
const READ_ACTIONS: ReadonlySet<string> = new Set(["viewDraft", "viewEmail", "viewSent", "viewReminder", "openConversation", "openContact"]);

/** Defense in depth for the container: a write intent reaching a read-only screen is dropped, whatever sent it. */
export const isReadOnlyAction = (type: string): boolean => READ_ACTIONS.has(type);
