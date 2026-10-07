"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { InfoIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import {
  ABSORPTION_NOTE_MAX,
  ABSORPTION_REFUSAL_KEY,
  normalizeCandidateQuery,
  type AbsorptionRefusalKey,
  type CandidateView,
} from "@/lib/companies/absorption";
import { stageBadgeClass, stageLabelOf } from "@/lib/companies/listMappers";
import type { ClientStrings } from "@/lib/i18n/clientStrings";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { proposeCompanyAbsorptionAction, searchAbsorptionCandidatesAction } from "../actions";

export type AbsorbedDialogLabels = ClientStrings<
  Pick<
    Dictionary["companyRecord"],
    | "cancel"
    | "genericError"
    | "absorbDialogTitle"
    | "absorbNoticeLead"
    | "absorbNoticeBefore"
    | "absorbNoticeAfter"
    | "absorbSearchLabel"
    | "absorbSearchHelp"
    | "absorbSearching"
    | "absorbNoResults"
    | "absorbSearchError"
    | "absorbNoDomain"
    | "absorbContactOne"
    | "absorbContactMany"
    | "absorbNoteLabel"
    | "absorbNoteHint"
    | "absorbRenameNote"
    | "absorbSubmit"
    | "absorbSubmitting"
    | "toastAbsorbProposed"
    | AbsorptionRefusalKey
  > &
    Pick<Dictionary["companyList"], "stageProspect" | "stageQualified" | "stageProposalSent" | "stageWon" | "stageLost">
>;

const SEARCH_DEBOUNCE_MS = 250;

/**
 * "Fue absorbida" dialog (mockup company-absorption/absorcion.html, section 2). Records a PROPOSAL for the owner;
 * nothing is merged, and the first line says so. Closes on success, stays open with the error on failure.
 */
export function AbsorbedDialog({
  companyKey,
  companyName,
  labels: l,
  onClose,
}: {
  companyKey: string;
  companyName: string;
  labels: AbsorbedDialogLabels;
  onClose: () => void;
}) {
  const ids = useId();
  const router = useRouter();
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CandidateView[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [picked, setPicked] = useState<CandidateView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drops a slow answer to an older keystroke so it can never overwrite a newer result list.
  const latest = useRef(0);

  const normalized = normalizeCandidateQuery(query);
  useEffect(() => {
    if (!normalized) {
      latest.current += 1;
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    const mine = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const rows = await searchAbsorptionCandidatesAction(companyKey, normalized);
      if (mine !== latest.current) return;
      setSearching(false);
      setSearchFailed(rows === null);
      setResults(rows ?? []);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalized, companyKey]);

  async function submit() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await proposeCompanyAbsorptionAction(companyKey, picked.key, note);
      if (result.ok) {
        onClose();
        showToast(l.toastAbsorbProposed);
        router.refresh();
      } else {
        setError(l[ABSORPTION_REFUSAL_KEY[result.reason]]);
      }
    } catch {
      setError(l.genericError);
    } finally {
      setBusy(false);
    }
  }

  // The picked company stays visible even when a later search no longer returns it.
  const shown = picked && !results.some((r) => r.key === picked.key) ? [picked, ...results] : results;

  return (
    <Dialog
      open
      onClose={onClose}
      title={l.absorbDialogTitle}
      closeDisabled={busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !picked}>
            {busy ? l.absorbSubmitting : l.absorbSubmit}
          </button>
        </>
      }
    >
      <div className="alert alert-info">
        <InfoIcon className="icon" />
        <div>
          <strong>{l.absorbNoticeLead}</strong>
          {l.absorbNoticeBefore}
          <strong>{companyName}</strong>
          {l.absorbNoticeAfter}
        </div>
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div>
        <label className="label" htmlFor={`${ids}-search`}>
          {l.absorbSearchLabel}
        </label>
        <input
          id={`${ids}-search`}
          className="input"
          type="search"
          autoComplete="off"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          aria-describedby={`${ids}-status`}
        />
        <div className="mt-sm" role="group" aria-label={l.absorbSearchLabel}>
          {shown.map((c) => (
            <button
              key={c.key}
              type="button"
              className="pick"
              aria-pressed={picked?.key === c.key}
              onClick={() => setPicked(c)}
              disabled={busy}
            >
              <span className="n">{c.displayName}</span>
              <span className="m">
                {c.stage && <span className={stageBadgeClass(c.stage)}>{stageLabelOf(c.stage, l)}</span>}
                <span>
                  {c.contacts} {c.contacts === 1 ? l.absorbContactOne : l.absorbContactMany}
                </span>
                <span className="dom">{c.domain ?? l.absorbNoDomain}</span>
              </span>
            </button>
          ))}
        </div>
        <p id={`${ids}-status`} className="help mt-sm" aria-live="polite">
          {!normalized
            ? l.absorbSearchHelp
            : searching
              ? l.absorbSearching
              : searchFailed
                ? l.absorbSearchError
                : results.length === 0
                  ? l.absorbNoResults
                  : ""}
        </p>
      </div>

      <div>
        <label className="label" htmlFor={`${ids}-note`}>
          {l.absorbNoteLabel} <span className="meta">{l.absorbNoteHint}</span>
        </label>
        <textarea
          id={`${ids}-note`}
          className="textarea"
          rows={2}
          maxLength={ABSORPTION_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="alert alert-neutral">
        <InfoIcon className="icon" />
        <div>{l.absorbRenameNote}</div>
      </div>
    </Dialog>
  );
}
