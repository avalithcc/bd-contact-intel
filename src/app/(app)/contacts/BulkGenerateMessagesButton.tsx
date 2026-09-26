"use client";

/**
 * "Generar mensajes" bulk action (mockups/contacts.html `.bulk-bar`).
 * Reads the checked `personId` boxes off the shared bulk-selection form at
 * click time (same technique as BulkActionsBar.tsx's buildExportHref),
 * calls the sequential bulk generator (bulkMessageActions.ts), and shows
 * one result per contact in a dialog with its own copy button — reusing
 * the same copy/copied/error/pending strings the per-contact
 * GenerateMessageButton already uses (src/lib/outreach/messageLabels.ts),
 * so the wording never drifts between the single and bulk paths.
 */
import { useState } from "react";
import { bulkGenerateMessagesAction, type BulkGenerateMessageResult } from "./bulkMessageActions";
import type { Locale } from "@/lib/i18n/locales";
import type { GenerateMessageLabels } from "@/lib/outreach/messageLabels";
import type { BulkActionsLabels } from "@/lib/contacts/labels";

export interface BulkGenerateMessagesButtonProps {
  formRef: React.RefObject<HTMLFormElement | null>;
  locale: Locale;
  labels: BulkActionsLabels;
  messageLabels: GenerateMessageLabels;
}

export function BulkGenerateMessagesButton({ formRef, locale, labels: l, messageLabels: m }: BulkGenerateMessagesButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<BulkGenerateMessageResult[] | null>(null);
  const [wasCapped, setWasCapped] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function run() {
    const form = formRef.current;
    if (!form) return;
    const ids = [...form.querySelectorAll<HTMLInputElement>('input[name="personId"]:checked')].map((box) => box.value);
    setOpen(true);
    setPending(true);
    setResults(null);
    const response = await bulkGenerateMessagesAction(locale, ids);
    setResults(response.results);
    setWasCapped(response.wasCapped);
    setPending(false);
  }

  async function copy(personId: string, message: string) {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedId(personId);
      setTimeout(() => setCopiedId((current) => (current === personId ? null : current)), 2000);
    } catch {
      // Same silent-ignore convention as GenerateMessageButton.tsx — the
      // text stays visible for manual copy either way.
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={run}>
        {l.bulkGenerateMessages}
      </button>
      {open && (
        <div className="overlay open" role="dialog" aria-modal="true" aria-labelledby="bulk-generate-messages-title">
          <div className="dialog">
            <div className="dialog-header">
              <h2 id="bulk-generate-messages-title">{l.bulkGenerateMessages}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm close"
                aria-label={l.bulkCancel}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              {wasCapped && <p className="alert alert-warn">{l.bulkMessagesCapNotice}</p>}
              {pending && (
                <p role="status">
                  <span className="spinner" aria-hidden="true" /> {m.generatingMessage}
                </p>
              )}
              {results?.map(({ personId, name, result }) => (
                <div key={personId} className="generate-message-result">
                  <p className="soft">{name}</p>
                  {result.ok ? (
                    <>
                      <p className="generate-message-text">{result.message}</p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => copy(personId, result.message)}
                      >
                        {copiedId === personId ? m.copiedMessage : m.copyMessage}
                      </button>
                    </>
                  ) : (
                    <p className="text-danger">{m.generateMessageErrors[result.errorKey]}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                {l.bulkCancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
