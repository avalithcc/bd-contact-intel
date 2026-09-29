"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import type { GenerateOutreachMessageResult } from "@/app/(app)/outreach/actions";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { signalLabelsFromDict } from "@/lib/outreach/messageLabels";
import { formatOutreachSignalLabel } from "@/lib/outreach/messageSignalLabels";
import { splitEmailDraft } from "@/lib/outreach/emailDraftFormat";
import type { OutreachChannel } from "@/lib/outreach/channel";
import { DEFAULT_OUTREACH_CHANNEL } from "@/lib/outreach/channel";
import { DEFAULT_MESSAGE_LANGUAGE, type MessageLanguage } from "@/lib/outreach/messageLanguage";

/**
 * "Generar mensaje" dialog (mockups/contact-record.html #generate): Canal +
 * Idioma selects, "Señales utilizadas" chips (from the actually-fed prompt
 * input — see messageSignals.ts, never the model's output), editable
 * "Borrador" textarea, and Regenerar/Copiar/Usar en correo footer. Replaces
 * the plain-text GenerateMessageButton on this page only — /outreach's
 * LinkedIn-triage list keeps that simpler component unchanged (no channel
 * choice there: BDs only use LinkedIn for the first touch, owner direction
 * 2026-09-26).
 *
 * Owns its own Dialog (rather than being rendered as an external Dialog's
 * children, as it was originally) so its footer buttons can live in the
 * Dialog's `footer` prop — same dialog-markup sweep as QuickActions.tsx: a
 * `.composer` wrapper here lit the whole form red on focus, and the footer
 * was a plain child div instead of `.dialog-footer`, which loses the
 * approved mockup's flush bottom bar (it renders inset, inside
 * `.dialog-body`'s padding) once nested that way.
 */
export function GenerateMessageDialog({
  title,
  onClose,
  boundAction,
  labels: l,
  useInEmailLabel,
  onUseInEmail,
}: {
  title: string;
  onClose: () => void;
  boundAction: (
    prevState: GenerateOutreachMessageResult | null,
    formData: FormData,
  ) => Promise<GenerateOutreachMessageResult>;
  labels: GenerateMessageLabels;
  // From ContactRecordLabels ("Usar en correo") — not part of
  // GenerateMessageLabels (the outreach dict slice), so it's passed
  // separately rather than duplicated into that type.
  useInEmailLabel: string;
  onUseInEmail: (subject: string, body: string) => void;
}) {
  const ids = useId();
  const formId = `${ids}-form`;
  const [state, formAction, pending] = useActionState<GenerateOutreachMessageResult | null, FormData>(
    boundAction,
    null,
  );
  const [channel, setChannel] = useState<OutreachChannel>(DEFAULT_OUTREACH_CHANNEL);
  const [language, setLanguage] = useState<MessageLanguage>(DEFAULT_MESSAGE_LANGUAGE);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  // Reseed the editable "Borrador" from a fresh successful generation —
  // but only then, so the BD's own edits survive re-renders in between.
  useEffect(() => {
    if (state?.ok) setDraft(state.message);
  }, [state]);

  const signalLabels = signalLabelsFromDict(l);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // draft stays visible for manual copy either way.
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          <button type="submit" form={formId} className="btn btn-ghost left" disabled={pending}>
            {pending ? l.generatingMessage : state?.ok ? l.regenerateMessage : l.generateMessageGenerateAction}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCopy} disabled={pending || !draft.trim()}>
            {copied ? l.copiedMessage : l.copyMessage}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !draft.trim()}
            onClick={() => {
              const { subject, body } = splitEmailDraft(draft);
              onUseInEmail(subject, body);
            }}
          >
            {useInEmailLabel}
          </button>
        </>
      }
    >
      <form id={formId} action={formAction} aria-busy={pending}>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor={`${ids}-channel`}>
              {l.generateMessageChannelLabel}
            </label>
            <select
              id={`${ids}-channel`}
              className="select"
              name="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as OutreachChannel)}
              disabled={pending}
            >
              <option value="email">{l.generateMessageChannelEmail}</option>
              <option value="linkedin">{l.generateMessageChannelLinkedin}</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor={`${ids}-language`}>
              {l.generateMessageLanguageLabel}
            </label>
            <select
              id={`${ids}-language`}
              className="select"
              name="messageLanguage"
              value={language}
              onChange={(e) => setLanguage(e.target.value as MessageLanguage)}
              disabled={pending}
            >
              <option value="es">{l.messageLanguageEs}</option>
              <option value="en">{l.messageLanguageEn}</option>
              <option value="pt">{l.messageLanguagePt}</option>
            </select>
          </div>
        </div>

        {state?.ok && state.signals.length > 0 && (
          <div className="field">
            <span className="label">{l.generateMessageSignalsLabel}</span>
            <div className="row wrap">
              {state.signals.map((signal, i) => (
                <span key={i} className="chip">
                  {formatOutreachSignalLabel(signal, signalLabels)}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor={`${ids}-draft`}>
            {l.generateMessageDraftLabel}
          </label>
          <textarea
            id={`${ids}-draft`}
            className="textarea"
            rows={7}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
          />
          <span className="help">{l.generateMessageDraftHelp}</span>
        </div>

        {state && !state.ok && (
          <p className="text-danger generate-message-error">{l.generateMessageErrors[state.errorKey]}</p>
        )}
      </form>
    </Dialog>
  );
}
