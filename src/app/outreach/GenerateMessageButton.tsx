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
 * satisfied by the language-choice submit buttons below. `locale` stays
 * bound only as the server-side fallback when the language field is
 * missing/invalid — the message's actual language always comes from the
 * inline "Español"/"English" choice the user submits (see the
 * "messageLanguage" field), which is independent of the UI locale.
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
  // Shows the inline "Español"/"English" choice instead of the plain
  // generate/regenerate button. Reopened on every generate AND regenerate
  // click, so the language can be switched each time rather than only once.
  const [choosingLanguage, setChoosingLanguage] = useState(false);

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
      <form action={formAction} aria-busy={pending}>
        {pending ? (
          <span className="generate-message-pending" role="status">
            <span className="spinner" aria-hidden="true" />
            {labels.generatingMessage}
          </span>
        ) : choosingLanguage ? (
          <span
            className="generate-message-language-choice"
            role="group"
            aria-label={labels.chooseMessageLanguage}
          >
            <button
              type="submit"
              name="messageLanguage"
              value="es"
              className="secondary-btn generate-message-language-btn"
              aria-label={labels.messageLanguageEs}
              onClick={() => setChoosingLanguage(false)}
            >
              {labels.messageLanguageEs}
            </button>
            <button
              type="submit"
              name="messageLanguage"
              value="en"
              className="secondary-btn generate-message-language-btn"
              aria-label={labels.messageLanguageEn}
              onClick={() => setChoosingLanguage(false)}
            >
              {labels.messageLanguageEn}
            </button>
            <button
              type="button"
              className="generate-message-language-cancel"
              aria-label={labels.cancelChooseLanguage}
              onClick={() => setChoosingLanguage(false)}
            >
              ×
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setChoosingLanguage(true)}
          >
            {state?.ok ? labels.regenerateMessage : labels.generateMessage}
          </button>
        )}
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
          <button
            type="button"
            className="secondary-btn"
            onClick={handleCopy}
            disabled={pending}
          >
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
