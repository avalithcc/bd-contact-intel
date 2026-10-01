"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/Dialog";
import type { ContactRecordLabels } from "@/lib/contacts/labels";

export interface ReplyDialogError {
  message: string;
  href?: string;
}

/**
 * "Responder" on a synced thread. Same field/footer layout as the "Correo"
 * composer (QuickActions' EmailForm), with recipient and subject read-only:
 * Gmail threads by subject as well as by headers, so editing the subject
 * would silently split the conversation. The server re-derives both (and the
 * threading headers) from the stored thread; this dialog only collects text.
 */
export function ReplyDialog({
  labels: l,
  to,
  subject,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  labels: ContactRecordLabels;
  to: string;
  subject: string;
  busy: boolean;
  error: ReplyDialogError | null;
  onCancel: () => void;
  onSubmit: (body: string) => void;
}) {
  const ids = useId();
  const [body, setBody] = useState("");

  return (
    <Dialog
      open
      onClose={onCancel}
      title={l.timelineReplyAction}
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !body.trim()}
            onClick={() => body.trim() && onSubmit(body.trim())}
          >
            {l.emailSend}
          </button>
        </>
      }
    >
      {error && (
        <div className="error-text" role="alert">
          {error.message}
          {error.href && (
            <>
              {" "}
              <Link href={error.href}>{l.gmailReconnectLink}</Link>
            </>
          )}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor={`${ids}-to`}>
          {l.emailToLabel}
        </label>
        <input id={`${ids}-to`} className="input" value={to} disabled />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-subject`}>
          {l.emailSubjectLabel}
        </label>
        <input id={`${ids}-subject`} className="input" value={subject} disabled />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-body`}>
          {l.emailBodyLabel}
        </label>
        <textarea
          id={`${ids}-body`}
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy}
        />
      </div>
    </Dialog>
  );
}
