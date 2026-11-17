"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { EditPencilIcon, ExternalLinkIcon } from "@/components/icons";
import type { CountryLine as CountryLineView } from "@/lib/sequences/audienceCard";
import { countryOptionsFor } from "@/lib/sequences/countryOptions";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";

/**
 * "País: Chile ✎ · Flybondi: Argentina ↗" under the headline. The person's own country is edited here; the container performs the
 * SAME write the contact record uses (updateContactPropertyAction, via the "setPersonCountry" action), so validation and the property
 * history stay in one place, and this component imports no server module. The company's
 * country is read-only on purpose: changing it moves the audience of every contact at that company, and the warning for that lives
 * on the company record, which the link opens. Saving never touches a draft: the card then warns when it went stale (draftDrift).
 */
export function CountryLine({ view, memberId, personId, name, l, onAction }: { view: CountryLineView; memberId: string; personId: string; name: string; l: SequenceLabels; onAction?: OnAction }) {
  const t = l.audience;
  const editable = onAction !== undefined;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(view.person ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLSelectElement>(null);
  const wasEditing = useRef(false);

  // Focus moves into the field when it opens and back to the pencil when it closes.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function open() { setValue(view.person ?? ""); setError(null); setEditing(true); }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await onAction?.({ type: "setPersonCountry", memberId, personId, country: value });
      if (saved === true) setEditing(false);
      else setError(t.countrySaveFailed);
    } catch {
      setError(t.countrySaveFailed);
    } finally {
      setBusy(false);
    }
  }

  // `.soft` (globals.css), not `.meta`: both dim the text, but `.meta` also drops it to --text-sm, which would make the
  // missing value smaller than a present one. The app's CSS is split across design-system.css AND globals.css, and
  // checking only the first is what made this read as "class does not exist".
  const shown = <span className={view.person ? "" : "soft"}>{view.person ?? t.countryNone}</span>;
  return (
    <div className="row wrap" style={{ gap: ".35rem" }}>
      <span className="meta">{t.countryLabel}</span>
      {editing ? (
        <form className="row" style={{ gap: ".25rem" }} onSubmit={save} onKeyDown={(e) => { if (e.key === "Escape" && !busy) setEditing(false); }}>
          {/* A select, not a text box: its options are derived from the same table `resolveCountry` matches against
              (see countryOptions.ts), so a BD cannot store a spelling the audience resolver will not understand. An
              unrecognised country does not degrade gracefully — it HOLDS the contact and no draft is ever written. */}
          <select
            ref={inputRef}
            className="select input-sm"
            aria-label={fill(t.countryInputAria, { name })}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          >
            <option value="">{t.countryNone}</option>
            {countryOptionsFor(view.person).map((o) => (
              <option key={`${o.iso}-${o.label}`} value={o.label}>{o.label}</option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t.countrySave}</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>{t.countryCancel}</button>
        </form>
      ) : editable ? (
        <button ref={editRef} type="button" className="btn btn-ghost btn-sm" aria-label={fill(t.countryEditAria, { name })} onClick={open}>{shown}<EditPencilIcon className="icon" /></button>
      ) : shown}
      {error && <span className="error-text" role="alert">{error}</span>}
      {view.company && (
        <>
          <span className="meta">·</span>
          <span className="meta">{view.company.name}:</span>
          <Link className="btn btn-ghost btn-sm" href={`/companies/${encodeURIComponent(view.company.key)}`} aria-label={fill(t.companyCountryOpenAria, { company: view.company.name })}>{view.company.country}<ExternalLinkIcon className="icon" /></Link>
        </>
      )}
    </div>
  );
}
