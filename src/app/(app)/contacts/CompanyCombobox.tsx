"use client";

/**
 * The new-contact dialog's company field (openspec/changes/contact-company-autocomplete/mockups/empresa.html).
 * Choosing an existing company is the default path; creating one, or saying "Sin empresa", is a visible decision.
 *
 * Request budget: the search is debounced (SEARCH_DEBOUNCE_MS, the same 250 ms the repo's other pickers use: longer
 * than the gap between keystrokes of a fast typist, so a burst becomes one request, short enough to feel live),
 * answers are cached per normalised query for the life of the dialog (backspacing costs nothing), an older answer
 * can never overwrite a newer one, and the empty-query "top companies" list is fetched once, only when the list
 * is first opened.
 *
 * The listbox follows RecipientFields.tsx: role=combobox input, aria-activedescendant, options that keep focus in
 * the input (mousedown is not allowed to blur it), arrows / Enter / Escape.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WarningIcon } from "@/components/icons";
import { findNearMatch, normalizePickerQuery, possibleDuplicateKeys, type PickerCompany } from "@/lib/companies/companyPicker";
import { companyMetaLine, type CompanyComboLabels } from "@/lib/companies/companyPickerLabels";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import { searchCompaniesForContactAction } from "./createContactActions";

const SEARCH_DEBOUNCE_MS = 250;

export interface CompanyChoice {
  text: string;
  /** Canonical key of the picked existing company; null for free text and for "Sin empresa". */
  key: string | null;
  /** The BD said "Sin empresa" on purpose. */
  none: boolean;
}

type Option = { kind: "company"; company: PickerCompany } | { kind: "create" } | { kind: "none" };

export function CompanyCombobox({
  id,
  labels: l,
  choice,
  onChoose,
  label,
  extra,
}: {
  id: string;
  labels: CompanyComboLabels;
  choice: CompanyChoice;
  onChoose: (next: CompanyChoice) => void;
  /** The dialog's own `<label>` (it carries the "Desde LinkedIn" badge). */
  label: React.ReactNode;
  /** Help text under the field (the "could not be read from the profile" hint). */
  extra?: React.ReactNode;
}) {
  const ids = useId();
  const listId = `${ids}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<{ q: string; rows: PickerCompany[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<PickerCompany | null>(null);
  // Typed key the BD already saw the near-match warning for and chose to create anyway.
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const cache = useRef(new Map<string, PickerCompany[]>());
  const latest = useRef(0);

  const isPicked = choice.key !== null;
  const searching = !isPicked && !choice.none;
  const q = normalizePickerQuery(choice.text);

  useEffect(() => {
    if (!searching) return;
    // The empty-query list is only worth a request once the BD actually opens the field.
    if (!q && !open) return;
    const hit = cache.current.get(q);
    if (hit) {
      latest.current += 1;
      setResults({ q, rows: hit });
      setFailed(false);
      return;
    }
    const mine = ++latest.current;
    const timer = setTimeout(
      async () => {
        const rows = await searchCompaniesForContactAction(q);
        if (mine !== latest.current) return;
        setFailed(rows === null);
        if (rows) {
          cache.current.set(q, rows);
          setResults({ q, rows });
        }
      },
      q ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [q, open, searching]);

  // Only answers for the text on screen count: a stale list must neither be offered nor trigger the warning.
  const loaded = results !== null && results.q === q;
  const rows = useMemo(() => (loaded ? results.rows : []), [loaded, results]);
  const typed = choice.text.trim();
  const typedKey = normalizeCompanyKey(typed);
  const exactExists = rows.some((c) => c.key === typedKey);
  const duplicates = useMemo(() => possibleDuplicateKeys(rows), [rows]);
  const options: Option[] = [
    ...rows.map((company): Option => ({ kind: "company", company })),
    ...(typed && !exactExists ? [{ kind: "create" } as const] : []),
    { kind: "none" },
  ];
  const nearMatch = searching && typed && acknowledged !== typedKey ? findNearMatch(typed, rows) : null;
  const firstActionIndex = rows.length;

  function choose(option: Option) {
    setOpen(false);
    setActive(-1);
    if (option.kind === "company") {
      setPicked(option.company);
      onChoose({ text: option.company.displayName, key: option.company.key, none: false });
    } else if (option.kind === "none") {
      setPicked(null);
      onChoose({ text: "", key: null, none: true });
    } else {
      setPicked(null);
      onChoose({ text: typed, key: null, none: false });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!searching) return;
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : options.length - 1);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + options.length) % options.length);
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === "Escape" && open) {
      // Closes the list only; never lets the key reach anything that would close the dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  }

  const pickedMeta = picked && picked.key === choice.key ? companyMetaLine(l, picked.domain, picked.contacts) : null;

  return (
    <div className="field">
      {label}
      <div
        className="rel"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
            setActive(-1);
          }
        }}
      >
        <input
          className="input"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${ids}-opt-${active}` : undefined}
          autoComplete="off"
          value={choice.none ? "" : choice.text}
          placeholder={choice.none ? l.none : l.placeholder}
          onFocus={() => searching && setOpen(true)}
          onChange={(e) => {
            setPicked(null);
            setOpen(true);
            // -1, never 0: Enter must not attach a company the BD never chose. Highlighting the first
            // result means typing "Acme" and pressing Enter to move on silently picks "Acme Corp" with
            // its canonical key -- and under two characters the list is the top companies, so Enter
            // would attach the biggest company in the CRM. This screen exists to make choosing a
            // company deliberate; a default highlight would make choosing the WRONG one an accident.
            // An arrow key or hover sets it; until then Enter does nothing.
            setActive(-1);
            onChoose({ text: e.target.value, key: null, none: false });
          }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <div className="picker" id={listId} role="listbox" aria-label={l.listLabel} onMouseDown={(e) => e.preventDefault()}>
            {!loaded && !failed && q && <div className="picker-note">{l.searching}</div>}
            {failed && <div className="picker-note error-text">{l.searchFailed}</div>}
            {options.map((option, index) => (
              <div key={index}>
                {index === firstActionIndex && <div className="menu-sep" role="presentation" />}
                <div
                  id={`${ids}-opt-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={`opt${index === active ? " act" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  {option.kind === "company" && (
                    <>
                      <span>
                        <span className="nm">{option.company.displayName}</span>
                        <br />
                        <span className="sub">{companyMetaLine(l, option.company.domain, option.company.contacts)}</span>
                      </span>
                      {q && (
                        <span className={`badge no-dot tail${duplicates.has(option.company.key) ? " badge-warn" : ""}`}>
                          {duplicates.has(option.company.key) ? l.badgePossibleDuplicate : l.badgeExisting}
                        </span>
                      )}
                    </>
                  )}
                  {option.kind === "create" && (
                    <>
                      <span>
                        {l.createPrefix} <span className="nm">«{typed}»</span>
                      </span>
                      <span className="badge no-dot tail">{l.badgeNew}</span>
                    </>
                  )}
                  {option.kind === "none" && (
                    <>
                      <span className="sub">{l.none}</span>
                      {choice.none && <span className="badge no-dot tail">{l.badgeChosen}</span>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {isPicked && (
        <span className="help">
          <span className="badge no-dot">{l.badgeExisting}</span> {pickedMeta}
        </span>
      )}
      {choice.none && (
        <span className="help">
          {l.none} <span className="badge no-dot">{l.badgeChosen}</span>
        </span>
      )}
      {extra}
      {nearMatch && !open && (
        <div role="status">
          <div className="alert alert-warn">
            <WarningIcon className="icon" />
            <div>
              <b>{l.nearTitle.replace("{name}", nearMatch.displayName)}</b> ({companyMetaLine(l, nearMatch.domain, nearMatch.contacts, ", ")}).
              <br />
              <span className="meta">{l.nearConsequence.replace("{typed}", typed)}</span>
            </div>
          </div>
          <div className="row mt-lg">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => choose({ kind: "company", company: nearMatch })}
            >
              {l.nearUse.replace("{name}", nearMatch.displayName)}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcknowledged(typedKey)}>
              {l.nearCreateAnyway}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
