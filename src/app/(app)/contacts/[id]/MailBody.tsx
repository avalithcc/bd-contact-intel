import { ChevronDownIcon } from "@/components/icons";
import { canExpandLoneEmailBody, loneEmailMessageId, type LoneEmailRow } from "@/lib/contacts/loneEmailBody";
import type { ThreadMessageBody } from "@/lib/gmail/threadMessages";

/** The stored text of one synced message plus the truncation note. Shared by the foreign-admin row and the lone own row. */
export function MailBodyText({ text, truncated, truncatedNote }: { text: string; truncated: boolean; truncatedNote: string }) {
  return (
    <>
      <div className="snippet" style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </div>
      {truncated && <p className="meta mt-2xs">{truncatedNote}</p>}
    </>
  );
}

export interface LoneEmailBodyLabels {
  show: string;
  hide: string;
  truncatedNote: string;
  empty: string;
}

/**
 * Lazy "Ver mensaje" toggle for a lone email row. Renders nothing when the row
 * is not eligible; the body is fetched by the parent on click, never on render.
 */
export function LoneEmailBody({
  row,
  viewer,
  expanded,
  loading,
  bodies,
  labels,
  onToggle,
}: {
  row: LoneEmailRow;
  viewer: { id: string };
  expanded: boolean;
  loading: boolean;
  bodies: Record<string, ThreadMessageBody> | undefined;
  labels: LoneEmailBodyLabels;
  onToggle: () => void;
}) {
  if (!canExpandLoneEmailBody(row, viewer)) return null;
  const messageId = loneEmailMessageId(row);
  const body = messageId ? bodies?.[messageId] : undefined;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm mt-md" aria-expanded={expanded} onClick={onToggle}>
        <ChevronDownIcon className="icon" />
        {expanded ? labels.hide : labels.show}
        {loading && <span className="spinner" aria-hidden="true" />}
      </button>
      {expanded && !loading && bodies &&
        (body?.bodyText ? (
          <MailBodyText text={body.bodyText} truncated={body.bodyTruncated} truncatedNote={labels.truncatedNote} />
        ) : (
          <p className="meta mt-2xs">{labels.empty}</p>
        ))}
    </>
  );
}
