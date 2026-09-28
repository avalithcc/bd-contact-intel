"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/ToastProvider";
import { EditPencilIcon } from "@/components/icons";
import type { TaskSubjectSearchResult } from "@/lib/tasks/subjectSearch";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import { changeContactCompanyAction, searchContactCompaniesAction } from "../actions";
// Reuses the "Nueva tarea" dialog's search-results/chip CSS (same shape:
// an inline listbox anchored under a text input) rather than inventing a
// second copy of that layout.
import styles from "../../tasks/NewTaskButton.module.css";

const SEARCH_DEBOUNCE_MS = 250;

export interface CurrentCompany {
  companyKey: string;
  displayName: string;
}

/**
 * "Cambiar empresa" pencil + dialog on the Contact record's "Empresa" card
 * (contact-record.html:160). The mockup drew the pencil but never wired a
 * destination, so it shipped inert (see page.tsx's comment history) — this
 * is that destination.
 *
 * Picks a company through the SAME bounded search pattern as the "Nueva
 * tarea" dialog's subject picker (subjectSearchDb.ts / NewTaskButton.tsx),
 * but with its own company-only query (companySearchDb.ts) — never free
 * text, so the base can never fill with "Globant"/"globant SA"/"Globant."
 * as three companies. Selecting a result or clicking "Quitar empresa"
 * saves immediately (no separate confirm step): each is already an
 * unambiguous, single choice, and requiring an extra "Guardar" click would
 * only add a step without adding safety — the dialog itself is the
 * confirmation. If the search finds nothing, a link points at
 * `/companies/new` instead of letting this dialog mint a new company.
 */
export function ChangeCompanyButton({
  personId,
  currentCompany,
  labels: l,
}: {
  personId: string;
  currentCompany: CurrentCompany | null;
  labels: ContactRecordLabels;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskSubjectSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchContactCompaniesAction(query);
      if (!cancelled) {
        setResults(found);
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function close() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setError(null);
  }

  async function save(companyKey: string | null) {
    setBusy(true);
    setError(null);
    try {
      const result = await changeContactCompanyAction(personId, companyKey);
      if (result.ok) {
        close();
        showToast(l.toastCompanyChanged);
        router.refresh();
      } else {
        setBusy(false);
        setError(contactActionErrorMessage(l, result.reason));
      }
    } catch {
      setBusy(false);
      setError(l.genericError);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label={l.changeCompanyAria}
        onClick={() => setOpen(true)}
      >
        <EditPencilIcon className="icon" />
      </button>

      {open && (
        <Dialog open onClose={close} title={l.changeCompanyAction}>
          <div className="composer">
            {error && (
              <div className="error-text" role="alert">
                {error}
              </div>
            )}

            <div className="field">
              <span>{l.changeCompanyCurrentLabel}</span>
              <div className={styles.subjectChip}>
                <span>{currentCompany?.displayName ?? l.noCompany}</span>
                {currentCompany && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>
                    {l.changeCompanyDetach}
                  </button>
                )}
              </div>
            </div>

            <label className="field">
              {l.changeCompanySearchLabel}
              <div className={styles.searchWrap}>
                <input
                  className="input"
                  value={query}
                  placeholder={l.changeCompanySearchPlaceholder}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                {searching && <p className="hint">{l.changeCompanySearching}</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="hint">
                    {l.changeCompanyNoResults}{" "}
                    <Link href="/companies/new">{l.changeCompanyCreateLink}</Link>
                  </p>
                )}
                {results.length > 0 && (
                  <ul className={styles.results} role="listbox">
                    {results.map((result) => (
                      <li key={result.id}>
                        <button
                          type="button"
                          className={styles.resultItem}
                          disabled={busy}
                          onClick={() => save(result.id)}
                        >
                          {result.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
          </div>
        </Dialog>
      )}
    </>
  );
}
