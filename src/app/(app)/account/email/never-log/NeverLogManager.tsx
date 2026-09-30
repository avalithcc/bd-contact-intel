"use client";

import { useState } from "react";
import { CloseIcon, MailIcon, PlusIcon } from "@/components/icons";
import { addNeverLogEntryAction, removeNeverLogEntryAction } from "../neverLogActions";
import type { EmailNeverLog } from "@/db/schema";
import type { NeverLogKind } from "@/lib/gmail/neverLogRules";

export interface NeverLogLabels {
  sectionTitle: string;
  typeLabel: string;
  typeAddressOption: string;
  typeDomainOption: string;
  valueLabel: string;
  valuePlaceholder: string;
  addButton: string;
  removeAria: string;
  chipAddressPrefix: string;
  chipDomainPrefix: string;
  domainExactHelp: string;
  emptyTitle: string;
  emptyBody: string;
  errorEmpty: string;
  errorInvalidAddress: string;
  errorInvalidDomain: string;
  errorUnexpected: string;
}

const ERROR_LABEL_KEY: Record<string, keyof NeverLogLabels> = {
  empty: "errorEmpty",
  invalid_address: "errorInvalidAddress",
  invalid_domain: "errorInvalidDomain",
  unexpected: "errorUnexpected",
};

/**
 * "Nunca registrar" list (email-sync.html screen 3, "Con elementos"/"Vacío"
 * states) — chip list with remove (×) + an add form, both wired to the
 * per-BD server actions in ../neverLogActions.ts. Owns its own list state
 * so add/remove never re-renders the whole page.
 */
export function NeverLogManager({ initialEntries, labels: l }: { initialEntries: EmailNeverLog[]; labels: NeverLogLabels }) {
  const [entries, setEntries] = useState(initialEntries);
  const [kind, setKind] = useState<NeverLogKind>("address");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await addNeverLogEntryAction(kind, value);
      if (result.ok) {
        setEntries(result.entries);
        setValue("");
      } else {
        setError(l[ERROR_LABEL_KEY[result.error]]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      const result = await removeNeverLogEntryAction(id);
      if (result.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
      } else {
        setError(l.errorUnexpected);
      }
    } finally {
      setRemovingId(null);
    }
  }

  const form = (
    <>
      <div className="form-grid">
        <div className="field">
          <label className="label" htmlFor="nl-type">
            {l.typeLabel}
          </label>
          <select
            className="select"
            id="nl-type"
            value={kind}
            onChange={(e) => setKind(e.target.value as NeverLogKind)}
          >
            <option value="address">{l.typeAddressOption}</option>
            <option value="domain">{l.typeDomainOption}</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="nl-val">
            {l.valueLabel}
          </label>
          <input
            className="input"
            id="nl-val"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={l.valuePlaceholder}
          />
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>
        <PlusIcon className="icon" />
        {l.addButton}
      </button>
    </>
  );

  if (entries.length === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <h3>{l.sectionTitle}</h3>
          <span className="meta">0</span>
        </div>
        <div className="card-body">
          <div className="empty">
            <div className="empty-icon">
              <MailIcon className="icon icon-lg" />
            </div>
            <h3>{l.emptyTitle}</h3>
            <p>{l.emptyBody}</p>
            <form onSubmit={handleAdd} style={{ textAlign: "left", maxWidth: 420, margin: "0 auto" }}>
              {form}
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>{l.sectionTitle}</h3>
        <span className="meta">{entries.length}</span>
      </div>
      <div className="card-body stack">
        <div className="row wrap">
          {entries.map((entry) => (
            <span key={entry.id} className="chip">
              <span className="k">{entry.kind === "domain" ? l.chipDomainPrefix : l.chipAddressPrefix}</span>{" "}
              {entry.value}
              <button
                type="button"
                className="chip-remove"
                aria-label={l.removeAria}
                disabled={removingId === entry.id}
                onClick={() => handleRemove(entry.id)}
              >
                <CloseIcon className="icon" />
              </button>
            </span>
          ))}
        </div>
        <div className="hr flush" />
        <form onSubmit={handleAdd}>{form}</form>
        <p className="help">{l.domainExactHelp}</p>
      </div>
    </div>
  );
}
