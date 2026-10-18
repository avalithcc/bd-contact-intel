"use client";

/**
 * "Nuevo contacto" dialog (mockups/contacts.html `#new-contact`). Calls
 * createContactAction (identity-resolver-backed, see its doc comment)
 * directly from the client, same "server action as a plain async function"
 * convention as BulkGenerateMessagesButton.tsx — no full-page round trip
 * needed to show the duplicate-warning banner inline.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CheckIcon, InfoIcon } from "@/components/icons";
import { withoutQueryParams } from "@/lib/contacts/linkedinCapture";
import { PREFILL_PARAM_KEYS, type ProfilePrefill } from "@/lib/contacts/linkedinProfilePrefill";
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
  jobTitleLabel: string;
  locationLabel: string;
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
  /** Only needed when `initialLinkedin` is passed (opened from /capture/linkedin). */
  fromLinkedinTitle?: string;
  fromLinkedinBody?: string;
  /** Only needed when `initialPrefill` is passed (opened by the LinkedIn extension). */
  fromLinkedinBadge?: string;
  reviewTitle?: string;
  reviewBody?: string;
  companyNotRead?: string;
  fieldNotRead?: string;
}

const EMPTY_INPUT: NewContactFormInput = {
  firstName: "",
  lastName: "",
  linkedinUrl: "",
  email: "",
  company: "",
  jobTitle: "",
  location: "",
};

/** Fields the LinkedIn extension can fill; each one wears the "Desde LinkedIn" badge until the BD edits it. */
type PrefillField = keyof ProfilePrefill;
const PREFILL_FIELDS: readonly PrefillField[] = ["firstName", "lastName", "company", "jobTitle", "location"];

/**
 * `initialCompany` (mockup-port c03): the company record's "Contacto" quick
 * action (company-record.html:66) opens this SAME dialog prefilled with the
 * company's display name — `NewContactFormInput.company` is already a free-
 * text name resolved to a `companyKey` server-side (see createContact.ts),
 * so no new field or action was needed, just this optional default.
 *
 * `renderTrigger` (mockup-port c05, small open item closed): lets a caller
 * swap the default `.btn.btn-primary` trigger for its own markup — the
 * company record's quick actions row needs the mockup's uniform `.qa`/
 * `.qa-icon` icon-button style (company-record.html:66), not a standalone
 * primary button, while `/contacts`' own "Nuevo contacto" trigger keeps the
 * default. Receives the same `onClick` the default button would use.
 *
 * `initialLinkedin` + `defaultOpen` (linkedin-exists-check): `/contacts?new=1&linkedin=…`
 * (the bookmarklet found nobody) opens the dialog already showing the link, with
 * the "aún no está en el CRM" notice. The caller passes a URL it has validated.
 *
 * `initialPrefill` (linkedin-extension): the basics the extension read from the profile when the BD pressed
 * "Agregar al CRM". Already cleaned and capped by parseProfilePrefill. Each non-empty field carries a
 * "Desde LinkedIn" badge that disappears when the BD edits it; an empty one says it could not be read.
 */
export function NewContactDialog({
  labels: l,
  initialCompany,
  initialLinkedin,
  initialPrefill,
  defaultOpen = false,
  renderTrigger,
}: {
  labels: NewContactDialogLabels;
  initialCompany?: string;
  initialLinkedin?: string;
  initialPrefill?: ProfilePrefill;
  defaultOpen?: boolean;
  renderTrigger?: (onClick: () => void) => React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(defaultOpen);
  const [pending, setPending] = useState(false);
  const emptyInput: NewContactFormInput = {
    ...EMPTY_INPUT,
    ...(initialCompany ? { company: initialCompany } : {}),
    ...(initialLinkedin ? { linkedinUrl: initialLinkedin } : {}),
    ...(initialPrefill ?? {}),
  };
  const prefilledFields = (): Set<PrefillField> =>
    new Set(initialPrefill ? PREFILL_FIELDS.filter((field) => initialPrefill[field] !== "") : []);
  const [input, setInput] = useState<NewContactFormInput>(emptyInput);
  // Fields still showing the value read from LinkedIn; editing one removes it.
  const [fromLinkedin, setFromLinkedin] = useState<Set<PrefillField>>(prefilledFields);
  const [result, setResult] = useState<CreateContactResult | null>(null);

  function close() {
    setOpen(false);
    // Opened from /contacts?new=1&linkedin=…: drop those params so a refresh does not reopen the dialog.
    if (searchParams.has("new") || searchParams.has("linkedin") || PREFILL_PARAM_KEYS.some((key) => searchParams.has(key))) {
      router.replace(withoutQueryParams(pathname, searchParams.toString(), ["new", "linkedin", ...PREFILL_PARAM_KEYS]));
    }
    setResult(null);
    setInput(emptyInput);
    setFromLinkedin(prefilledFields());
  }

  function edit(field: keyof NewContactFormInput, value: string) {
    setInput((s) => ({ ...s, [field]: value }));
    setFromLinkedin((prev) => {
      if (!prev.has(field as PrefillField)) return prev;
      const next = new Set(prev);
      next.delete(field as PrefillField);
      return next;
    });
  }

  /** Label text plus the badge / "could not be read" hint for a field the extension may have filled. */
  function fieldLabel(field: PrefillField, htmlFor: string, text: string) {
    return (
      <label className="label" htmlFor={htmlFor}>
        {text}
        {fromLinkedin.has(field) && l.fromLinkedinBadge && (
          <>
            {" "}
            <span className="badge badge-outline no-dot">{l.fromLinkedinBadge}</span>
          </>
        )}
      </label>
    );
  }
  function notReadHelp(field: PrefillField) {
    if (!initialPrefill || initialPrefill[field] !== "" || input[field] !== "") return null;
    const text = field === "company" ? l.companyNotRead : l.fieldNotRead;
    return text ? <span className="help">{text}</span> : null;
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
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          {l.triggerLabel}
        </button>
      )}
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
              {initialPrefill && l.reviewTitle && !result ? (
                <div className="alert alert-info" role="status">
                  <InfoIcon className="icon" />
                  <div>
                    <div className="title">{l.reviewTitle}</div>
                    {l.reviewBody}
                  </div>
                </div>
              ) : (
                initialLinkedin &&
                l.fromLinkedinTitle &&
                !result && (
                  <div className="alert alert-success" role="status">
                    <CheckIcon className="icon" />
                    <div>
                      <div className="title">{l.fromLinkedinTitle}</div>
                      {l.fromLinkedinBody}
                    </div>
                  </div>
                )
              )}
              <div className="form-grid">
                <div className="field">
                  {fieldLabel("firstName", "nc-f", l.firstNameLabel)}
                  <input
                    className="input"
                    id="nc-f"
                    autoFocus={Boolean(initialLinkedin)}
                    value={input.firstName}
                    onChange={(e) => edit("firstName", e.target.value)}
                  />
                  {notReadHelp("firstName")}
                </div>
                <div className="field">
                  {fieldLabel("lastName", "nc-l", l.lastNameLabel)}
                  <input className="input" id="nc-l" value={input.lastName} onChange={(e) => edit("lastName", e.target.value)} />
                  {notReadHelp("lastName")}
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
                  onChange={(e) => edit("linkedinUrl", e.target.value)}
                />
                <span className="help">{l.linkedinHelp}</span>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label className="label" htmlFor="nc-e">
                    {l.emailLabel}
                  </label>
                  <input className="input" id="nc-e" value={input.email} onChange={(e) => edit("email", e.target.value)} />
                </div>
                <div className="field">
                  {fieldLabel("company", "nc-c", l.companyLabel)}
                  <input className="input" id="nc-c" value={input.company} onChange={(e) => edit("company", e.target.value)} />
                  {notReadHelp("company")}
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  {fieldLabel("jobTitle", "nc-j", l.jobTitleLabel)}
                  <input className="input" id="nc-j" value={input.jobTitle ?? ""} onChange={(e) => edit("jobTitle", e.target.value)} />
                  {notReadHelp("jobTitle")}
                </div>
                <div className="field">
                  {fieldLabel("location", "nc-u", l.locationLabel)}
                  <input className="input" id="nc-u" value={input.location ?? ""} onChange={(e) => edit("location", e.target.value)} />
                  {notReadHelp("location")}
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
