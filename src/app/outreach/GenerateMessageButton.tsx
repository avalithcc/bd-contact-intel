"use client";

import { useActionState, useState } from "react";
import { generateOutreachMessage, type GenerateOutreachMessageResult } from "./actions";
import type { Locale } from "@/lib/i18n/locales";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";

/**
 * "Generate message" control for one contact — calls the
 * generateOutreachMessage server action (Claude via the AI Gateway, see
 * src/app/outreach/actions.ts) and renders the result inline with a
 * copy-to-clipboard button. Resubmitting the same form regenerates.
 *
 * `contactId` and `locale` are bound into the server action ahead of
 * useActionState so the (prevState, formData) signature it expects is
 * satisfied by a plain, argument-less submit button.
 */
export function GenerateMessageButton({
  contactId,
  locale,
  labels,
}: {
  contactId: string;
  locale: Locale;
  labels: GenerateMessageLabels;
}) {
  const boundAction = generateOutreachMessage.bind(null, contactId, locale);
  const [state, formAction, pending] = useActionState<
    GenerateOutreachMessageResult | null,
    FormData
  >(boundAction, null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!state?.ok) return;
    try {
      await navigator.clipboard.writeText(state.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context, older
      // browsers) — the message text stays visible for manual copy either
      // way, so this is silently ignored rather than shown as an error.
    }
  };

  return (
    <div className="generate-message">
      <form action={formAction}>
        <button type="submit" className="secondary-btn" disabled={pending}>
          {pending
            ? labels.generatingMessage
            : state?.ok
              ? labels.regenerateMessage
              : labels.generateMessage}
        </button>
      </form>

      {state?.ok && (
        <div className="generate-message-result">
          {state.historyCount > 0 && (
            <p className="soft generate-message-history-hint">
              {(state.historyCount === 1
                ? labels.generateMessageHistoryHintOne
                : labels.generateMessageHistoryHintMany
              ).replace("{n}", String(state.historyCount))}
            </p>
          )}
          <p className="generate-message-text">{state.message}</p>
          <button type="button" className="secondary-btn" onClick={handleCopy}>
            {copied ? labels.copiedMessage : labels.copyMessage}
          </button>
        </div>
      )}

      {state && !state.ok && (
        <p className="text-danger generate-message-error">
          {labels.generateMessageErrors[state.errorKey]}
        </p>
      )}
    </div>
  );
}
