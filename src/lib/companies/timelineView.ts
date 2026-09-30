import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { CompanyTimelineRow } from "@/lib/companies/recordQueries";
import { taskActivityBody, type TaskActivityMetadata } from "@/lib/tasks/taskActivityBody";

/**
 * Plain-string labels this module needs to build a row's "what" headline —
 * a subset of `CompanyTimeline.tsx`'s own label props (company-record.html's
 * per-type "at…" copy plus "Reunión registrada").
 */
export interface CompanyTimelineViewLabels {
  meetingLogged: string;
  atNote: string;
  atEmailSent: string;
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
}

export interface CompanyTimelineViewRow extends CompanyTimelineRow {
  /** Precomputed headline (e.g. "Nota · Ana", "Llamada · Bruno Diaz"). */
  what: string;
  /** The note body, when `type === "note"`; `null` otherwise. */
  body: string | null;
}

function typeLabel(l: CompanyTimelineViewLabels, type: string): string {
  switch (type) {
    case "note":
      return l.atNote;
    case "email_sent":
      return l.atEmailSent;
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
 */
export function buildCompanyTimelineViewRows(
  rows: readonly CompanyTimelineRow[],
  serverStrings: Dictionary["companyRecordServer"],
  labels: CompanyTimelineViewLabels,
  stageLabelOf: (stage: string) => string,
): CompanyTimelineViewRow[] {
  return rows.map((row) => {
    const metadata = row.metadata ?? {};
    let what: string;
    if (row.scope === "company") {
      if (row.type === "note") what = serverStrings.noteBy(row.actorName ?? "");
      else if (row.type === "email_sent")
        what = serverStrings.emailSentTo(typeof metadata.to === "string" ? metadata.to : "");
      else if (row.type === "status_change") {
        const from = typeof metadata.from === "string" ? stageLabelOf(metadata.from) : "";
        const to = typeof metadata.status === "string" ? stageLabelOf(metadata.status) : "";
        what = serverStrings.stageChanged(from, to);
      } else if (row.type === "meeting_logged") what = labels.meetingLogged;
      else what = typeLabel(labels, row.type);
    } else {
      what = row.personName ? `${typeLabel(labels, row.type)} · ${row.personName}` : typeLabel(labels, row.type);
    }
    const body =
      row.type === "note" && typeof metadata.note === "string"
        ? metadata.note
        : TASK_ACTIVITY_TYPES_SET.has(row.type)
          ? taskActivityViewBody(row.type, metadata, row.actorName, labels)
          : null;
    return { ...row, what, body };
  });
}
