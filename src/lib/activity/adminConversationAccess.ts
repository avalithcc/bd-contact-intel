/**
 * Pure predicate behind the "Ver conversación (queda registrado)" action on a
 * locked timeline row (admin-conversation-access mockup, screen 1). Timeline.tsx
 * calls this for both the locked-thread card and the locked single-entry card
 * — kept here, not inlined, so the rule ("admin, locked, and the row actually
 * has an owning BD to send the audit-scoped route to") is unit-testable
 * without rendering React, and so the server (page.tsx computes `isAdmin`)
 * and the client (Timeline.tsx) can never disagree on it.
 *
 * `locked` mirrors `isTimelineEntryVisible`'s inverse (src/lib/activity/
 * timelineVisibility.ts) — only `email_sent`/`reply_received` rows are ever
 * locked, so `targetBdId` is expected to be non-null whenever `locked` is
 * true (a locked row always belongs to SOME BD); the null check is a defensive
 * guard, not a real code path, since the route this action leads to
 * (`/contacts/[id]/conversation/[bdId]`) is meaningless without one.
 */
export function canShowAdminConversationAction(input: {
  isAdmin: boolean;
  locked: boolean;
  targetBdId: string | null;
}): boolean {
  return input.isAdmin && input.locked && input.targetBdId !== null;
}
