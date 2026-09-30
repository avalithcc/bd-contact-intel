import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";

/**
 * One message inside a `.thread` card — the same `.thread-msg` markup the
 * contact record's own timeline uses for a synced email thread
 * (src/app/(app)/contacts/[id]/Timeline.tsx's `renderThreadMessage`), pulled
 * out so the admin-only conversation page (admin-conversation-access mockup,
 * "Correos sincronizados") can render the exact same look without depending
 * on Timeline's client-only, lazy-load-on-expand state (`threadBodies`,
 * `toggleQuoted`, skeleton rows) — this page always has the full body
 * eagerly (`getConversationForAdmin` never truncates for redaction, only
 * `bodyTruncated` for size).
 *
 * `bodyText` is always rendered as a plain text node (React's default
 * escaping) — never `dangerouslySetInnerHTML`; `emailMessage.bodyText` is
 * stored as plain text only (see that table's schema comment), so there is
 * no HTML to strip here, only to never introduce.
 */
export function EmailThreadMessage({
  avatarId,
  senderName,
  isSent,
  sentLabel,
  receivedLabel,
  when,
  recipientPrefix,
  recipientText,
  bodyText,
  bodyTruncated,
  bodyTruncatedNote,
}: {
  avatarId: string;
  senderName: string;
  isSent: boolean;
  sentLabel: string;
  receivedLabel: string;
  when: string;
  recipientPrefix: string;
  recipientText: string | null;
  bodyText: string;
  bodyTruncated: boolean;
  bodyTruncatedNote: string;
}) {
  return (
    <div className="thread-msg">
      <Avatar id={avatarId} initials={initialsFromName(senderName)} variant={isSent ? "bd" : "circle"} size="sm" />
      <div>
        <div className="thread-msg-head">
          <span className="who">
            <span className="from">{senderName}</span>{" "}
            <span className={isSent ? "badge badge-info no-dot" : "badge badge-success no-dot"}>
              {isSent ? sentLabel : receivedLabel}
            </span>
          </span>
          <span className="when">{when}</span>
        </div>
        {recipientText && (
          <span className="meta recipient">
            {recipientPrefix} {recipientText}
          </span>
        )}
        <div className="snippet" style={{ whiteSpace: "pre-wrap" }}>
          {bodyText}
        </div>
        {bodyTruncated && <p className="meta mt-2xs">{bodyTruncatedNote}</p>}
      </div>
    </div>
  );
}
