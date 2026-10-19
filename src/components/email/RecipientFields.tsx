"use client";

import { useId, useRef, useState } from "react";
import { listColleagueSuggestionsAction, listRecipientCandidatesAction } from "@/app/(app)/contacts/composeActions";
import { Avatar } from "@/components/Avatar";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { initialsFromName } from "@/components/initials";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { MAX_CC, checkCcAddress } from "@/lib/email/recipients/cc";
import { filterPickerOptions, matchTypedAddress, type PickerCandidate } from "@/lib/email/recipients/picker";

/**
 * "Para" and "CC" of the composer (mockups/redactar-email.html, sections 1, 1b and 2).
 *
 * Para: the record's contact is fixed (a chip without "x"); the BD adds other contacts of the SAME company from a picker, or
 * by typing the exact email of a listed contact. There are no free addresses; the server enforces it again.
 * CC: only @avalith.net colleagues, typed as chips (BDs are suggested). Nothing is logged for them.
 */
export interface RecipientDraft {
  id: string;
  name: string;
  email: string;
}

export interface CcDraft {
  address: string;
  name?: string;
}

const removeLabel = (prefix: string, who: string) => `${prefix} ${who}`;

function RemoveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="chip-remove" aria-label={label} onClick={onClick} disabled={disabled}>
      <CloseIcon className="icon" />
    </button>
  );
}

export function ParaField(props: {
  labels: ContactRecordLabels;
  personId: string;
  primary: { name: string; email: string };
  companyName: string | null;
  /** False when the record has no company: the picker stays disabled and only the record's contact can receive the email. */
  hasCompany: boolean;
  others: RecipientDraft[];
  onChange: (others: RecipientDraft[]) => void;
  disabled: boolean;
  ccOpen: boolean;
  ccRowId: string;
  onToggleCc: () => void;
}) {
  const { labels: l, others, disabled } = props;
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [typedError, setTypedError] = useState(false);
  const [candidates, setCandidates] = useState<PickerCandidate[] | "loading" | "error" | null>(null);

  const company = props.companyName ?? "";
  const picked = new Set(others.map((o) => o.id));
  const options = Array.isArray(candidates) ? filterPickerOptions(candidates, picked, query) : [];
  const total = others.length + 1;

  async function openPicker() {
    setOpen(true);
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (candidates === null || candidates === "error") {
      setCandidates("loading");
      const result = await listRecipientCandidatesAction(props.personId);
      setCandidates(result.ok ? result.candidates.map((c) => ({ id: c.id, name: c.name, email: c.email, jobTitle: c.jobTitle })) : "error");
    }
  }
  function closePicker() {
    setOpen(false);
    setQuery("");
    setTypedError(false);
  }
  function pick(c: PickerCandidate) {
    if (!c.email) return;
    props.onChange([...others, { id: c.id, name: c.name, email: c.email }]);
    setQuery("");
    setTypedError(false);
    setActive(0);
  }
  /** Enter / comma / leaving the field with text typed: only the email of a listed contact is accepted. */
  function commitTyped() {
    const typed = query.trim();
    if (!typed) return;
    const match = Array.isArray(candidates) ? matchTypedAddress(candidates, picked, typed) : null;
    if (match) pick(match);
    else setTypedError(true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // closes the picker, not the dialog
      closePicker();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const option = query.includes("@") ? null : options[active];
      if (option && !option.disabled) pick(option);
      else commitTyped();
    } else if (e.key === "Backspace" && query === "" && others.length > 0) {
      props.onChange(others.slice(0, -1));
    }
  }

  const helpId = `${ids}-help`;
  return (
    <div className="field">
      <div className="row">
        <label className="label" htmlFor={`${ids}-input`}>
          {l.emailToLabel}
        </label>
        <span className="grow" />
        <button type="button" className="cc-toggle" aria-expanded={props.ccOpen} aria-controls={props.ccRowId} onClick={props.onToggleCc}>
          {props.ccOpen ? l.emailCcHide : l.emailCcShow}
        </button>
      </div>
      <div className="rel">
        <div
          className={`rcpt${typedError ? " is-invalid" : ""}${!props.hasCompany ? " is-disabled" : ""}`}
          role="group"
          aria-label={l.emailRecipientsGroup}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              commitTyped();
              closePicker();
            }
          }}
        >
          <span className="chip locked" title={l.emailRecipientLockedTitle}>
            <Avatar id={props.personId} initials={initialsFromName(props.primary.name)} size="sm" />
            {props.primary.name} <span className="k">{props.primary.email}</span>
          </span>
          {others.map((o) => (
            <span className="chip" key={o.id}>
              <Avatar id={o.id} initials={initialsFromName(o.name)} size="sm" />
              {o.name} <span className="k">{o.email}</span>
              <RemoveButton label={removeLabel(l.emailRecipientRemovePrefix, o.name)} disabled={disabled} onClick={() => props.onChange(others.filter((x) => x.id !== o.id))} />
            </span>
          ))}
          {open ? (
            <input
              id={`${ids}-input`}
              ref={inputRef}
              className="typed"
              role="combobox"
              aria-expanded
              aria-controls={`${ids}-list`}
              aria-activedescendant={options[active] ? `${ids}-opt-${options[active]!.id}` : undefined}
              aria-invalid={typedError || undefined}
              aria-describedby={typedError ? `${ids}-err` : undefined}
              aria-label={`${l.emailPickerSearchPrefix} ${company}`}
              placeholder={`${l.emailPickerSearchPrefix} ${company}…`}
              value={query}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setTypedError(false);
              }}
              onKeyDown={onKeyDown}
            />
          ) : (
            <button
              type="button"
              id={`${ids}-input`}
              className="rcpt-add"
              aria-haspopup="listbox"
              aria-describedby={!props.hasCompany ? helpId : undefined}
              disabled={disabled || !props.hasCompany}
              title={!props.hasCompany ? l.emailRecipientsNoCompany : undefined}
              onClick={() => void openPicker()}
            >
              <PlusIcon className="icon" />
              {l.emailRecipientAdd}
            </button>
          )}
        </div>
        {open && (
          <div className="picker" id={`${ids}-list`} role="listbox" aria-label={`${l.emailPickerListPrefix} ${company}`} onMouseDown={(e) => e.preventDefault()}>
            <div className="menu-label">
              {l.emailPickerListPrefix} {company}
            </div>
            {candidates === "loading" || candidates === null ? (
              <div className="picker-note">{l.emailPickerLoading}</div>
            ) : candidates === "error" ? (
              <div className="picker-note error-text">{l.emailPickerError}</div>
            ) : options.length === 0 ? (
              <div className="picker-note">
                {l.emailPickerEmptyPrefix} {company} {l.emailPickerEmptySuffix}
              </div>
            ) : (
              options.map((o, index) => (
                <div
                  key={o.id}
                  id={`${ids}-opt-${o.id}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={o.disabled || undefined}
                  className={`opt${index === active ? " act" : ""}${o.disabled ? " off" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => !o.disabled && pick(o)}
                >
                  <Avatar id={o.id} initials={initialsFromName(o.name)} size="sm" />
                  <span>
                    <span className="nm">{o.name}</span>
                    <br />
                    <span className="sub">
                      {[o.jobTitle, o.email ?? "—"].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {o.disabled && <span className="tail badge badge-none no-dot">{l.emailPickerNoEmail}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {typedError && (
        <p className="error-text" id={`${ids}-err`} role="alert">
          {l.emailRecipientOtherCompany} {company}.
        </p>
      )}
      {!props.hasCompany ? (
        <p className="help" id={helpId}>
          {l.emailRecipientsNoCompany}
        </p>
      ) : total > 1 ? (
        <p className="help" id={helpId}>
          {total} {l.emailRecipientsCount}
          {company ? ` · ${l.emailRecipientsAllOf} ${company}` : ""}. {l.emailRecipientsSeeEachOther}
        </p>
      ) : null}
    </div>
  );
}

export function CcField(props: {
  labels: ContactRecordLabels;
  id: string;
  items: CcDraft[];
  onChange: (items: CcDraft[]) => void;
  /** Addresses already in Para: they cannot also be in CC. */
  paraAddresses: string[];
  disabled: boolean;
}) {
  const { labels: l, items, disabled } = props;
  const ids = useId();
  const [text, setText] = useState("");
  const [errorKey, setErrorKey] = useState<"invalid" | "internal" | "many" | null>(null);
  const [focused, setFocused] = useState(false);
  const [colleagues, setColleagues] = useState<{ name: string; email: string }[] | null>(null);

  function add(address: string, name?: string) {
    const checked = checkCcAddress(address);
    if (!checked.ok) return setErrorKey(checked.reason === "cc_not_internal" ? "internal" : "invalid");
    const exists = items.some((i) => i.address === checked.address) || props.paraAddresses.some((p) => p.trim().toLowerCase() === checked.address);
    if (!exists && items.length >= MAX_CC) return setErrorKey("many");
    if (!exists) props.onChange([...items, { address: checked.address, name }]);
    setErrorKey(null);
  }
  /** Enter, comma, semicolon or leaving the field: each address typed or pasted becomes a chip (or an error). */
  function commit() {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    if (parts.length === 0) return;
    parts.forEach((part) => add(part, colleagues?.find((c) => c.email === part.toLowerCase())?.name));
    setText("");
  }

  const q = text.trim().toLowerCase();
  const suggestions =
    focused && q ? (colleagues ?? []).filter((c) => !items.some((i) => i.address === c.email) && (c.email.includes(q) || c.name.toLowerCase().includes(q))).slice(0, 6) : [];
  const errorText = errorKey === "internal" ? l.errorCcNotInternal : errorKey === "many" ? l.errorCcTooMany : errorKey === "invalid" ? l.errorCcInvalid : null;

  return (
    <div className="field" id={props.id}>
      <label className="label" htmlFor={`${ids}-input`}>
        {l.emailCcLabel}
      </label>
      <div className="rel">
        <div className={`rcpt${errorText ? " is-invalid" : ""}`}>
          {items.map((i) => (
            <span className="chip" key={i.address}>
              <Avatar id={i.address} initials={initialsFromName(i.name ?? i.address.split("@")[0]!)} size="sm" />
              {i.name ? `${i.name} ` : ""}
              <span className="k">{i.address}</span>
              <RemoveButton label={removeLabel(l.emailCcRemovePrefix, i.address)} disabled={disabled} onClick={() => props.onChange(items.filter((x) => x.address !== i.address))} />
            </span>
          ))}
          <input
            id={`${ids}-input`}
            className="typed"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={`${ids}-list`}
            aria-label={l.emailCcAria}
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? `${ids}-err` : `${ids}-help`}
            placeholder={l.emailCcPlaceholder}
            value={text}
            disabled={disabled}
            autoComplete="off"
            onFocus={() => {
              setFocused(true);
              if (colleagues === null) void listColleagueSuggestionsAction().then((r) => setColleagues(r.ok ? r.colleagues : []));
            }}
            onChange={(e) => {
              setText(e.target.value);
              setErrorKey(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === ";") {
                if (text.trim()) {
                  e.preventDefault();
                  if (e.key === "Enter" && !text.includes("@") && suggestions[0]) {
                    // A name was typed: Enter takes the first suggested colleague.
                    add(suggestions[0].email, suggestions[0].name);
                    setText("");
                  } else commit();
                }
              } else if (e.key === "Backspace" && text === "" && items.length > 0) {
                props.onChange(items.slice(0, -1));
              } else if (e.key === "Escape" && suggestions.length) {
                e.preventDefault();
                e.stopPropagation();
                setText("");
              }
            }}
            onBlur={() => {
              setFocused(false);
              commit();
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="picker" id={`${ids}-list`} role="listbox" aria-label={l.emailCcSuggestions} onMouseDown={(e) => e.preventDefault()}>
            <div className="menu-label">{l.emailCcSuggestions}</div>
            {suggestions.map((c) => (
              <div
                key={c.email}
                role="option"
                aria-selected={false}
                className="opt"
                onClick={() => {
                  add(c.email, c.name);
                  setText("");
                }}
              >
                <Avatar id={c.email} initials={initialsFromName(c.name)} size="sm" />
                <span>
                  <span className="nm">{c.name}</span>
                  <br />
                  <span className="sub">{c.email}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {errorText && (
        <p className="error-text" id={`${ids}-err`} role="alert">
          {errorText}
        </p>
      )}
      <p className="help" id={`${ids}-help`}>
        {l.emailCcHelp}
      </p>
    </div>
  );
}
