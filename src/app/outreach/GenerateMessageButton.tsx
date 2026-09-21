"use client";

import { useActionState, useState } from "react";
import { generateOutreachMessage, type GenerateOutreachMessageResult } from "./actions";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dictionaries";

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
  dict,
}: {
  contactId: string;
  locale: Locale;
  dict: Dictionary;
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
            ? dict.outreach.generatingMessage
            : state?.ok
              ? dict.outreach.regenerateMessage
              : dict.outreach.generateMessage}
        </button>
      </form>

      {state?.ok && (
        <div className="generate-message-result">
          <p className="generate-message-text">{state.message}</p>
          <button type="button" className="secondary-btn" onClick={handleCopy}>
            {copied ? dict.outreach.copiedMessage : dict.outreach.copyMessage}
          </button>
        </div>
      )}

      {state && !state.ok && (
        <p className="text-danger generate-message-error">
          {dict.outreach.generateMessageErrors[state.errorKey]}
        </p>
      )}
    </div>
  );
}
