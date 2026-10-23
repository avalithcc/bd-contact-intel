"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { InfoIcon, WarningIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { DAILY_SEND_CAP_CEILING, DAILY_SEND_CAP_DEFAULT, DAILY_SEND_CAP_WARN_ABOVE } from "@/lib/sequences/capValidation";
import { createFormView } from "@/lib/sequences/createForm";
import type { IndustryCounts } from "@/lib/sequences/industryCounts";
import type { CountryCounts, SignalCounts } from "@/lib/sequences/pickerCounts";
import type { PickerPage, PickerQuery } from "@/lib/sequences/pickerFilters";
import { selectionSummary, type PickerContact, type Selection } from "@/lib/sequences/pickerView";
import { COMPANY_MEMBER_LIMIT } from "@/lib/sequences/rosterGuards";
import { DEFAULT_SCHEDULE } from "@/lib/sequences/schedule";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnCreateSequence } from "./actions";
import { RosterPicker } from "./RosterPicker";

/** "Elegiste {n} contactos de {c} empresas" with the two numbers in bold, as the mockup draws it. */
function chosenLine(template: string, vars: { n: number; c: number; contacts: string; companies: string }): ReactNode[] {
  return template.split(/(\{n\}|\{c\})/).map((part, i) => (part === "{n}" ? <strong key={i}>{vars.n}</strong> : part === "{c}" ? <strong key={i}>{vars.c}</strong> : fill(part, vars)));
}

/**
 * The "Nueva secuencia" form (mockups/secuencia-nueva.html). It reports the validated values through `onSubmit` and never
 * calls an action; the container closes over success and passes `error` / `busy` back. `account` is null when the BD has
 * no connected Gmail account: nothing can be created then, and the form says so instead of inventing an address.
 */
export function SequenceCreateForm({ contacts, hasMore, loadPage, industryCounts, countryCounts, signalCounts, account, labels: l, statusLabels, onSubmit, busy = false, error = null }: { contacts: readonly PickerContact[]; hasMore: boolean; loadPage: (query: PickerQuery) => Promise<PickerPage>; industryCounts?: IndustryCounts | null; countryCounts?: CountryCounts | null; signalCounts?: SignalCounts | null; account: { address: string } | null; labels: SequenceLabels; statusLabels: Dictionary["leadStatuses"]; onSubmit: OnCreateSequence; busy?: boolean; error?: string | null }) {
  const id = useId();
  const [name, setName] = useState("");
  const [cap, setCap] = useState(String(DAILY_SEND_CAP_DEFAULT));
  const [selection, setSelection] = useState<Selection>(new Map());
  const [attempted, setAttempted] = useState(false);
  const v = createFormView({ name, cap, selectedCount: selection.size, hasAccount: account !== null });
  const { companyCount: companies } = selectionSummary(selection);
  const { step1, step2 } = DEFAULT_SCHEDULE;
  const capHelp = fill(l.newCapHelp, { default: DAILY_SEND_CAP_DEFAULT, max: DAILY_SEND_CAP_CEILING });
  const submitLabel = v.submit === "none" ? l.newSubmitNone : fill(v.submit === "one" ? l.newSubmitOne : l.newSubmit, { n: selection.size });
  return (
    <>
      <div className="page-header"><div className="titles"><div className="eyebrow">{l.eyebrow}</div><h1>{l.newTitle}<span className="dot">.</span></h1>
        <p className="meta">{l.newIntroLead} <strong>{l.newIntroStrong}</strong>.</p></div></div>
      <form noValidate onSubmit={(e) => {
        e.preventDefault();
        setAttempted(true);
        if (v.valid && !busy) onSubmit({ name: name.trim(), dailySendCap: v.cap.value as number, personIds: [...selection.keys()] });
      }}>
        <div className="card mb-lg"><div className="card-header"><h3>{l.newSettings}</h3></div>
          <div className="card-body stack">
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor={`${id}-name`}>{l.newName}</label>
                <input className={`input${attempted && v.nameMissing ? " is-invalid" : ""}`} id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required aria-invalid={attempted && v.nameMissing} aria-describedby={`${id}-name-h`} />
                {attempted && v.nameMissing ? <span className="error-text" id={`${id}-name-h`}>{l.newNameError}</span> : <span className="help" id={`${id}-name-h`}>{l.newNameHelp}</span>}
              </div>
              <div className="field">
                <label className="label" htmlFor={`${id}-account`}>{l.newAccount}</label>
                <div className="row"><input className="input grow" id={`${id}-account`} value={account?.address ?? ""} readOnly aria-describedby={`${id}-account-h`} />
                  <span className={`badge ${account ? "badge-success" : "badge-danger"}`}>{account ? l.newAccountOn : l.newAccountOff}</span></div>
                <span className="help" id={`${id}-account-h`}>{account ? <>{l.newAccountHelpLead} <Link href="/account">{l.newAccountLink}</Link>{l.newAccountHelpTail}</> : l.newAccountMissing}</span>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor={`${id}-cap`}>{l.newCap}</label>
                <input className={`input${v.cap.error ? " is-invalid" : ""}`} id={`${id}-cap`} type="number" min={1} max={DAILY_SEND_CAP_CEILING} step={1} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={v.cap.error !== null} aria-describedby={`${id}-cap-h`} />
                <span className="help">{capHelp}</span>
                {v.cap.error && <span className="error-text" id={`${id}-cap-h`}>{fill(v.cap.error === "ceiling" ? l.newCapCeiling : l.newCapInvalid, { max: DAILY_SEND_CAP_CEILING })}</span>}
              </div>
              <div className="field">
                <label className="label" htmlFor={`${id}-cadence`}>{l.newCadence}</label>
                <select className="select" id={`${id}-cadence`} aria-describedby={`${id}-cadence-h`} defaultValue="default"><option value="default">{fill(l.newCadenceOption, { n: step2.afterDays })}</option></select>
                <span className="help" id={`${id}-cadence-h`}>{fill(l.newCadenceHelp, { time: `${String(step1.hour).padStart(2, "0")}:00`, n: step2.afterDays })}</span>
              </div>
            </div>
            {v.cap.warn && (
              <div className="alert alert-warn" role="status"><WarningIcon className="icon" /><div><div className="title">{fill(l.newCapWarnTitle, { n: DAILY_SEND_CAP_WARN_ABOVE })}</div>{l.newCapWarnBody}</div></div>
            )}
          </div>
        </div>
        <div className="card"><div className="card-header"><h3>{l.newContacts}</h3>
          <span className="meta">{chosenLine(l.newChosen, { n: selection.size, c: companies, contacts: selection.size === 1 ? l.unitContactOne : l.unitContactMany, companies: companies === 1 ? l.unitCompanyOne : l.unitCompanyMany })}</span></div>
          <div className="card-body">
            <div className="alert alert-neutral mb-lg"><InfoIcon className="icon" /><div>{l.newRulesLead} <strong>{fill(l.newRulesStrong, { limit: COMPANY_MEMBER_LIMIT })}</strong>{l.newRulesTail}</div></div>
            <RosterPicker contacts={contacts} hasMore={hasMore} loadPage={loadPage} industryCounts={industryCounts} countryCounts={countryCounts} signalCounts={signalCounts} selection={selection} onChange={setSelection} labels={l} statusLabels={statusLabels} />
          </div>
        </div>
        <div className="form-actions">
          {error && <span className="error-text" role="alert">{error}</span>}
          <Link className="btn btn-ghost" href="/sequences">{l.newCancel}</Link>
          <button type="submit" className="btn btn-primary" disabled={v.blocked || busy}>{submitLabel}</button>
        </div>
      </form>
    </>
  );
}
