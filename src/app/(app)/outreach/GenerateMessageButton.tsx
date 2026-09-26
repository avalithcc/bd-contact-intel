"use client";

import { useActionState, useState } from "react";
import type { GenerateOutreachMessageResult } from "./actions";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";

/**
 * "Generate message" control for one contact — calls a server action bound
 * to the caller's subject (contact or person) and renders the result inline
 * with a copy-to-clipboard button. Resubmitting the same form regenerates.
 *
 * `boundAction` is a server action already bound to its subject id and the
 * UI-locale fallback (e.g. `generateOutreachMessage.bind(null, contactId,
 * locale)` on /outreach and /whats-new, or `generatePersonOutreachMessageAction.bind(null,
 * personId, locale)` on the /contacts/[id] record page — task 13.3) so this
 * component stays subject-agnostic: `useActionState` only needs the
 * (prevState, formData) signature, satisfied by the language-choice submit
 * buttons below. The bound locale is only the server-side fallback when the
 * language field is missing/invalid — the message's actual language always
 * comes from the inline "Español"/"English" choice the user submits (see
 * the "messageLanguage" field), independent of the UI locale.
 *
 * `onGenerated`, when given, fires with the generated text on success —
 * used by the record page (task 13.3) to also populate the email composer,
 * on top of this component's own copy-to-clipboard display.
 */
export function GenerateMessageButton({
  boundAction,
  labels,
  onGenerated,
}: {
  boundAction: (
    prevState: GenerateOutreachMessageResult | null,
    formData: FormData,
  ) => Promise<GenerateOutreachMessageResult>;
  labels: GenerateMessageLabels;
  onGenerated?: (message: string) => void;
}) {
  const wrappedAction = async (
    prevState: GenerateOutreachMessageResult | null,
    formData: FormData,
  ): Promise<GenerateOutreachMessageResult> => {
    const result = await boundAction(prevState, formData);
    if (result.ok) onGenerated?.(result.message);
    return result;
  };
  const [state, formAction, pending] = useActionState<
    GenerateOutreachMessageResult | null,
    FormData
  >(wrappedAction, null);
  const [copied, setCopied] = useState(false);
  // Shows the inline "Español"/"English" choice instead of the plain
  // generate/regenerate button. Reopened on every generate AND regenerate
  // click, so the language can be switched each time rather than only once.
  const [choosingLanguage, setChoosingLanguage] = useState(false);

  // Close the language chooser from inside the form action, not from the
  // submit buttons' onClick: an onClick state update unmounts the clicked
  // submitter before the browser dispatches `submit`, which silently cancels
  // the submission. By the time this runs, FormData already holds the
  // submitter's messageLanguage value.
  const submitWithLanguage = (formData: FormData) => {
    setChoosingLanguage(false);
    formAction(formData);
  };

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
      <form action={submitWithLanguage} aria-busy={pending}>
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
            >
              {labels.messageLanguageEs}
            </button>
            <button
              type="submit"
              name="messageLanguage"
              value="en"
              className="secondary-btn generate-message-language-btn"
              aria-label={labels.messageLanguageEn}
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
