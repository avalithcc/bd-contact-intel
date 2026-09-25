"use client";

import { useState } from "react";
import { draftLeadEmailAction, sendLeadEmailAction } from "@/app/(app)/leads/actions";
import styles from "./EmailComposer.module.css";

const DRAFT_ERRORS: Record<string, string> = {
  notFound: "Lead not found.",
  gatewayNotConfigured: "AI gateway is not configured.",
  generationFailed: "Could not generate a draft. Try again.",
};

const SEND_ERRORS: Record<string, string> = {
  notFound: "Lead not found.",
  noEmail: "This lead has no email address yet.",
  sendFailed: "Could not send the email.",
};

export function EmailComposer({
  leadId,
  leadEmail,
}: {
  leadId: string;
  leadEmail: string | null;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [signalCount, setSignalCount] = useState<number | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWritingManually, setIsWritingManually] = useState(false);

  const hasDraft = isWritingManually || subject !== "" || body !== "";

  const handleDraft = async () => {
    setIsDrafting(true);
    setError(null);
    const result = await draftLeadEmailAction(leadId);
    setIsDrafting(false);

    if (!result.ok) {
      setError(DRAFT_ERRORS[result.errorKey] ?? DRAFT_ERRORS.generationFailed!);
      return;
    }
    setSubject(result.subject);
    setBody(result.body);
    setSignalCount(result.signalCount);
  };

  const handleSend = async () => {
    setIsSending(true);
    setError(null);
    const result = await sendLeadEmailAction(leadId, subject, body);
    setIsSending(false);

    if (!result.ok) {
      setError(
        result.errorDetail ?? SEND_ERRORS[result.errorKey] ?? SEND_ERRORS.sendFailed!,
      );
      return;
    }
    setSent(true);
    setSubject("");
    setBody("");
    setIsWritingManually(false);
  };

  if (!leadEmail) {
    return (
      <p className={styles.note}>
        This lead has no email address yet, so there is nothing to send to.
      </p>
    );
  }

  if (sent) {
    return (
      <div className={styles.sent}>
        <p>Email sent to {leadEmail}. It is now in the activity timeline.</p>
        <button className={styles.secondaryButton} onClick={() => setSent(false)}>
          Write another
        </button>
      </div>
    );
  }

  return (
    <div className={styles.composer}>
      {error && <div className={styles.error}>{error}</div>}

      {!hasDraft ? (
        <div className={styles.empty}>
          <p className={styles.note}>Sending to {leadEmail}</p>
          <button
            className={styles.primaryButton}
            onClick={handleDraft}
            disabled={isDrafting}
          >
            {isDrafting ? "Drafting..." : "Draft with AI"}
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => setIsWritingManually(true)}
            disabled={isDrafting}
          >
            Write it myself
          </button>
        </div>
      ) : (
        <>
          {signalCount === 0 && (
            <p className={styles.note}>
              No signals were available, so this draft is generic. Paste a signal above
              for a more specific hook.
            </p>
          )}

          <label className={styles.label}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={styles.input}
            disabled={isSending}
          />

          <label className={styles.label}>Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={styles.textarea}
            disabled={isSending}
          />

          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              onClick={handleSend}
              disabled={isSending || !subject.trim() || !body.trim()}
            >
              {isSending ? "Sending..." : "Send from my Gmail"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleDraft}
              disabled={isDrafting || isSending}
            >
              {isDrafting ? "Drafting..." : "Redraft"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setSubject("");
                setBody("");
                setError(null);
                setIsWritingManually(false);
              }}
              disabled={isSending}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
