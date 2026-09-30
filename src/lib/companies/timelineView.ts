import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { CompanyTimelineRow } from "@/lib/companies/recordQueries";
import { taskActivityBody, type TaskActivityMetadata } from "@/lib/tasks/taskActivityBody";
import { isTimelineEntryVisible } from "@/lib/activity/timelineVisibility";

/**
 * Plain-string labels this module needs to build a row's "what" headline —
 * a subset of `CompanyTimeline.tsx`'s own label props (company-record.html's
 * per-type "at…" copy plus "Reunión registrada").
 */
export interface CompanyTimelineViewLabels {
  meetingLogged: string;
  atNote: string;
  atEmailSent: string;
  // Synced Gmail reply (email-sync brief) — same entry layout email_sent
  // uses today; full-thread UI is a later slice. `atReplyReceivedDefault`
  // is the body fallback when neither subject nor sender is available.
  atReplyReceived: string;
  atReplyReceivedDefault: string;
  atStatusChange: string;
  atMeetingLogged: string;
  atCall: string;
  atDiscarded: string;
  atHunterLookup: string;
  atStatusBackfill: string;
  atTaskUpdated: string;
  atTaskCompleted: string;
  atTaskReopened: string;
  taskChangeFieldTitle: string;
  taskChangeFieldDue: string;
  taskChangeFieldAssignee: string;
  taskChangeFieldDescription: string;
  taskChangeUpdatedPrefix: string;
  taskChangeCompletedPrefix: string;
  taskChangeReopenedPrefix: string;
  taskChangeUnknownActor: string;
  // Fresh-review BLOCKER fix, 2026-09-30 — same copy the contact timeline
  // uses for a locked conversation-content row (timelineEntryBody.ts).
  timelineLockedContent: string;
}

export interface CompanyTimelineViewRow extends CompanyTimelineRow {
  /** Precomputed headline (e.g. "Nota · Ana", "Llamada · Bruno Diaz"). Never derived from a locked row's metadata — see `visible`. */
  what: string;
  /** The note/reply/task body, or the locked-content copy when `!visible`; `null` for a type with no body at all. */
  body: string | null;
  // Fresh-review BLOCKER fix, 2026-09-30: getCompanyTimeline never applied
  // the contact timeline's privacy rule, so once the Gmail sync ran, every
  // BD would see every other BD's email subjects/addresses on company
  // records. `visible` is `isTimelineEntryVisible({ type, actorBdId },
  // viewerBdId)` (src/lib/activity/timelineVisibility.ts) — the SAME check
  // the contact timeline runs, so any future CONVERSATION_CONTENT_TYPES
  // addition (e.g. a LinkedIn type) is covered here for free. `metadata` on
  // this row is `null` whenever `visible` is `false` — redacted HERE,
  // server-side, so it is never even serialized to the "use client"
  // CompanyTimeline.tsx, not just hidden by JSX.
  visible: boolean;
}

function typeLabel(l: CompanyTimelineViewLabels, type: string): string {
  switch (type) {
    case "note":
      return l.atNote;
    case "email_sent":
      return l.atEmailSent;
    case "reply_received":
      return l.atReplyReceived;
    case "status_change":
      return l.atStatusChange;
    case "status_backfill":
      return l.atStatusBackfill;
    case "meeting_logged":
      return l.atMeetingLogged;
    case "call":
      return l.atCall;
    case "discarded":
      return l.atDiscarded;
    case "hunter_lookup":
      return l.atHunterLookup;
    case "task_updated":
      return l.atTaskUpdated;
    case "task_completed":
      return l.atTaskCompleted;
    case "task_reopened":
      return l.atTaskReopened;
    default:
      return type;
  }
}

const TASK_ACTIVITY_TYPES_SET = new Set(["task_updated", "task_completed", "task_reopened"]);

/**
 * Same content shape as the Contact record's `entryBody` `reply_received`
 * case (src/lib/contacts/timelineEntryBody.ts) — subject and sender
 * address, never the body (full-thread UI is a later slice).
 */
function replyReceivedBody(metadata: Record<string, unknown>, l: CompanyTimelineViewLabels): string {
  const subject = typeof metadata.subject === "string" ? metadata.subject : null;
  const from = typeof metadata.from === "string" ? metadata.from : null;
  const parts = [subject, from].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : l.atReplyReceivedDefault;
}

function taskActivityViewBody(
  type: string,
  metadata: Record<string, unknown>,
  actorName: string | null,
  l: CompanyTimelineViewLabels,
): string {
  return taskActivityBody(type, metadata as TaskActivityMetadata, actorName, {
    fieldTitle: l.taskChangeFieldTitle,
    fieldDue: l.taskChangeFieldDue,
    fieldAssignee: l.taskChangeFieldAssignee,
    fieldDescription: l.taskChangeFieldDescription,
    updatedPrefix: l.taskChangeUpdatedPrefix,
    completedPrefix: l.taskChangeCompletedPrefix,
    reopenedPrefix: l.taskChangeReopenedPrefix,
    unknownActor: l.taskChangeUnknownActor,
  });
}

/**
 * Formats each raw timeline row's "what" (headline) and "body" text
 * SERVER-SIDE (fix/company-timeline-filter-no-reload). This is the one piece
 * of the Activity tab's rendering that genuinely needs
 * `serverStrings` (`Dictionary["companyRecordServer"]`'s FORMATTER
 * FUNCTIONS — `noteBy`/`emailSentTo`/`stageChanged`) and `stageLabelOf`.
 * Neither can cross into a Client Component — React cannot serialize a
 * function prop (see `src/lib/companies/labels.ts`'s doc comment on the
 * production crash this exact class of bug already caused once) — so this
 * runs wherever the rows themselves are produced: `page.tsx`'s initial load
 * AND `getCompanyTimelineFilterEntriesAction`'s scoped fetch. The CLIENT
 * component (`CompanyTimeline.tsx`) only ever receives the already-formatted
 * plain strings this returns.
 *
 * `viewerBdId` (fresh-review BLOCKER fix, 2026-09-30) is required, not
 * optional — every call site already has it from `getCurrentBd()`, and
 * making it optional would silently reopen the privacy gap for any future
 * caller that forgets to pass it.
 */
export function buildCompanyTimelineViewRows(
  rows: readonly CompanyTimelineRow[],
  serverStrings: Dictionary["companyRecordServer"],
  labels: CompanyTimelineViewLabels,
  stageLabelOf: (stage: string) => string,
  viewerBdId: string,
): CompanyTimelineViewRow[] {
  return rows.map((row) => {
    // Same rule the contact timeline runs (src/lib/activity/timelineEntry.ts)
    // — `false` only for a CONVERSATION_CONTENT_TYPES row
    // (email_sent/reply_received) whose actorBdId isn't this viewer's own.
    // Every other type is always `true`, so this never affects note/call/
    // status_change/etc regardless of who logged them.
    const visible = isTimelineEntryVisible({ type: row.type, actorBdId: row.actorBdId }, viewerBdId);
    // Metadata is computed from the RAW row only for building `what`/`body`
    // below — an empty object when locked, so no branch here can
    // accidentally read a real subject/address into either. The row
    // actually returned at the bottom carries `metadata: null` when locked.
    const metadata = visible ? (row.metadata ?? {}) : {};
    let what: string;
    if (row.scope === "company") {
      if (row.type === "note") what = serverStrings.noteBy(row.actorName ?? "");
      else if (row.type === "email_sent")
        what = visible
          ? serverStrings.emailSentTo(typeof metadata.to === "string" ? metadata.to : "")
          : typeLabel(labels, row.type);
      else if (row.type === "status_change") {
        const from = typeof metadata.from === "string" ? stageLabelOf(metadata.from) : "";
        const to = typeof metadata.status === "string" ? stageLabelOf(metadata.status) : "";
        what = serverStrings.stageChanged(from, to);
      } else if (row.type === "meeting_logged") what = labels.meetingLogged;
      else what = typeLabel(labels, row.type);
    } else {
      // Never derived from metadata either way — the contact's name (not
      // sensitive conversation content) is the only thing this headline
      // ever shows for a person-scoped row.
      what = row.personName ? `${typeLabel(labels, row.type)} · ${row.personName}` : typeLabel(labels, row.type);
    }
    const body = !visible
      ? labels.timelineLockedContent
      : row.type === "note" && typeof metadata.note === "string"
        ? metadata.note
        : row.type === "reply_received"
          ? replyReceivedBody(metadata, labels)
          : TASK_ACTIVITY_TYPES_SET.has(row.type)
            ? taskActivityViewBody(row.type, metadata, row.actorName, labels)
            : null;
    return { ...row, what, body, visible, metadata: visible ? row.metadata : null };
  });
}
