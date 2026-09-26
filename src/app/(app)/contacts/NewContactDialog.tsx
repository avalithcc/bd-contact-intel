"use client";

/**
 * "Nuevo contacto" dialog (mockups/contacts.html `#new-contact`). Calls
 * createContactAction (identity-resolver-backed, see its doc comment)
 * directly from the client, same "server action as a plain async function"
 * convention as BulkGenerateMessagesButton.tsx — no full-page round trip
 * needed to show the duplicate-warning banner inline.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createContactAction, type CreateContactResult } from "./createContactActions";
import type { NewContactFormInput } from "@/lib/contacts/createContact";

export interface NewContactDialogLabels {
  triggerLabel: string;
  title: string;
  firstNameLabel: string;
  lastNameLabel: string;
  linkedinLabel: string;
  linkedinHelp: string;
  emailLabel: string;
  companyLabel: string;
  cancelLabel: string;
  createLabel: string;
  createAnywayLabel: string;
  openExistingLabel: string;
  duplicateWarningPrefix: string;
  duplicateWarningBody: string;
  existingMatchTitle: string;
  existingMatchBody: string;
  blockedOwnCompany: string;
  invalidRequiresName: string;
}

const EMPTY_INPUT: NewContactFormInput = { firstName: "", lastName: "", linkedinUrl: "", email: "", company: "" };

export function NewContactDialog({ labels: l }: { labels: NewContactDialogLabels }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState<NewContactFormInput>(EMPTY_INPUT);
  const [result, setResult] = useState<CreateContactResult | null>(null);

  function close() {
    setOpen(false);
    setResult(null);
    setInput(EMPTY_INPUT);
  }

  async function submit(confirmDuplicate: boolean) {
    setPending(true);
    const response = await createContactAction(input, confirmDuplicate);
    setPending(false);
    setResult(response);
    if (response.action === "created" && response.personId) {
      close();
      router.push(`/contacts/${response.personId}`);
      router.refresh();
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {l.triggerLabel}
      </button>
      {open && (
        <div className="overlay open" role="dialog" aria-modal="true" aria-labelledby="new-contact-title">
          <div className="dialog">
            <div className="dialog-header">
              <h2 id="new-contact-title">{l.title}</h2>
              <button type="button" className="btn btn-ghost btn-icon btn-sm close" aria-label={l.cancelLabel} onClick={close}>
                ×
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="nc-f">
                    {l.firstNameLabel}
                  </label>
                  <input
                    className="input"
                    id="nc-f"
                    value={input.firstName}
                    onChange={(e) => setInput((s) => ({ ...s, firstName: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="nc-l">
                    {l.lastNameLabel}
                  </label>
                  <input
                    className="input"
                    id="nc-l"
                    value={input.lastName}
                    onChange={(e) => setInput((s) => ({ ...s, lastName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="nc-li">
                  {l.linkedinLabel}
                </label>
                <input
                  className="input"
                  id="nc-li"
                  placeholder="https://www.linkedin.com/in/…"
                  value={input.linkedinUrl}
                  onChange={(e) => setInput((s) => ({ ...s, linkedinUrl: e.target.value }))}
                />
                <span className="help">{l.linkedinHelp}</span>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="nc-e">
                    {l.emailLabel}
                  </label>
                  <input
                    className="input"
                    id="nc-e"
                    value={input.email}
                    onChange={(e) => setInput((s) => ({ ...s, email: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="nc-c">
                    {l.companyLabel}
                  </label>
                  <input
                    className="input"
                    id="nc-c"
                    value={input.company}
                    onChange={(e) => setInput((s) => ({ ...s, company: e.target.value }))}
                  />
                </div>
              </div>

              {result?.action === "invalid" && <p className="text-danger">{l.invalidRequiresName}</p>}
              {result?.action === "blocked_own_company" && <p className="alert alert-warn">{l.blockedOwnCompany}</p>}
              {result?.action === "existing_match" && (
                <div className="alert alert-info">
                  <div className="title">{l.existingMatchTitle}</div>
                  {l.existingMatchBody.replace("{name}", result.existingName ?? "")}{" "}
                  <a href={`/contacts/${result.existingPersonId}`}>{l.openExistingLabel}</a>
                </div>
              )}
              {result?.action === "needs_confirmation" && (
                <div className="alert alert-warn">
                  <div className="title">
                    {l.duplicateWarningPrefix}: {result.existingName}
                  </div>
                  {l.duplicateWarningBody} <a href={`/contacts/${result.existingPersonId}`}>{l.openExistingLabel}</a>
                </div>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn btn-secondary" onClick={close}>
                {l.cancelLabel}
              </button>
              {result?.action === "needs_confirmation" ? (
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => submit(true)}>
                  {l.createAnywayLabel}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => submit(false)}>
                  {l.createLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
