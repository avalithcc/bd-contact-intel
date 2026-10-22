"use client";

// Edits one BD's personal Lusha daily cap in a dialog (lusha-cap-editor; mockups/editor-tope.html). One field, three outcomes: empty =
// no personal cap, a number = that ceiling, 0 = blocked. The server decides everything (validation, role, audit); this only calls the
// action. The credits-per-contact figure, the team's daily rail and today's spend arrive as plain props from the server page: a client
// file may only TYPE-import src/lib/lusha (tests/unit/lushaInert.test.ts), so nothing here is a constant of its own.

import { useState, useTransition } from "react";
import { Dialog } from "@/components/Dialog";
import { EditPencilIcon, WarningIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { capContactsText, capSaveIntent, readCapField } from "@/lib/credits/capText";
import { setLushaPersonalCapAction } from "./actions";


/** The dictionary strings as they are, placeholders unfilled: this component fills {name}, {credits}, {contacts}... itself. */
export interface CapEditorLabels {
  setButton: string;
  editAria: string;
  title: string;
  fieldLabel: string;
  placeholder: string;
  creditsOne: string;
  creditsMany: string;
  equivalence: string;
  costNote: string;
  usedToday: string;
  hintEmptySet: string;
  hintEmptyEdit: string;
  hintZeroBefore: string;
  hintZeroAfter: string;
  recordedSet: string;
  recordedChange: string;
  invalid: string;
  warnRailTitle: string;
  warnRailBody: string;
  warnZeroTitle: string;
  warnZeroBody: string;
  clear: string;
  cancel: string;
  save: string;
  toastSet: string;
  toastCleared: string;
  toastBlocked: string;
  toastUnchanged: string;
  errorSave: string;
  personalContacts: string;
  personalContactsOne: string;
  personalContactsNone: string;
  personalContactsBlocked: string;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

export function LushaCapEditor(props: {
  bdId: string;
  name: string;
  adminName: string;
  cap: number | null;
  /** The table's own text for the current cap (personalCapLines), so the row and the dialog cannot drift. */
  headline: string;
  contacts: string;
  todayCredits: number;
  creditsPerContact: number;
  dailyRail: number;
  maxCap: number;
  labels: CapEditorLabels;
}) {
  const { bdId, name, adminName, cap, todayCredits, creditsPerContact, dailyRail, maxCap, labels: l } = props;
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const credits = (n: number) => (n === 1 ? l.creditsOne : fill(l.creditsMany, { n }));
  const value = readCapField(text, maxCap);
  const typed = typeof value === "number" ? value : null;

  function show() {
    setText(cap === null ? "" : String(cap));
    setOpen(true);
  }

  function save(text: string) {
    const intent = capSaveIntent(text, maxCap);
    if (!intent.send) return; // invalid input sends nothing: never "clear the cap" by accident
    const next = intent.cap;
    start(async () => {
      let result = { ok: false, changed: false };
      try {
        result = await setLushaPersonalCapAction(bdId, next);
      } catch {
        result = { ok: false, changed: false };
      }
      if (!result.ok) return showToast(l.errorSave, "error");
      setOpen(false);
      if (!result.changed) return showToast(fill(l.toastUnchanged, { name }));
      showToast(fill(next === null ? l.toastCleared : next === 0 ? l.toastBlocked : l.toastSet, { name, credits: next === null ? "" : credits(next) }));
    });
  }

  const trigger =
    cap === null ? (
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={show}>
          {l.setButton}
        </button>
      </div>
    ) : (
      <div className="meta">
        <strong>{props.headline}</strong> · {props.contacts}
        <button type="button" className="btn btn-ghost btn-icon btn-sm edit" onClick={show} aria-label={fill(l.editAria, { name })}>
          <EditPencilIcon className="icon" />
        </button>
      </div>
    );

  return (
    <>
      {trigger}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closeDisabled={pending}
        title={fill(l.title, { name })}
        footer={
          <>
            {cap !== null && (
              <button type="button" className="btn btn-ghost left" onClick={() => save("")} disabled={pending}>
                {l.clear}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
              {l.cancel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => save(text)} disabled={pending || value === undefined}>
              {l.save}
            </button>
          </>
        }
      >
        <div className="field" style={{ maxWidth: 240 }}>
          <label className="label" htmlFor={`cap-${bdId}`}>
            {l.fieldLabel}
          </label>
          <input className="input" id={`cap-${bdId}`} type="text" inputMode="numeric" autoComplete="off" placeholder={l.placeholder} value={text} aria-invalid={value === undefined} onChange={(e) => setText(e.target.value)} />
        </div>
        {value === undefined && <p className="meta mt-md">{fill(l.invalid, { max: maxCap })}</p>}
        {typed !== null && typed > 0 && (
          <p className="meta mt-md">
            <strong>{fill(l.equivalence, { credits: credits(typed), contacts: capContactsText(typed, creditsPerContact, l) })}</strong>
            {cap === null ? ` ${fill(l.costNote, { per: creditsPerContact })}` : ""}
            {(cap !== null || todayCredits > 0) && ` ${fill(l.usedToday, { used: credits(todayCredits), left: credits(Math.max(0, typed - todayCredits)) })}`}
          </p>
        )}
        <p className="meta mt-md">
          {cap === null ? fill(l.hintEmptySet, { name }) : l.hintEmptyEdit} {l.hintZeroBefore} <strong>0</strong> {fill(l.hintZeroAfter, { name })}
        </p>
        {typed !== null && typed > dailyRail && (
          <div className="alert alert-warn mt-md" role="note">
            <WarningIcon className="icon" />
            <div>
              <div className="title">{l.warnRailTitle}</div>
              {fill(l.warnRailBody, { daily: dailyRail })}
            </div>
          </div>
        )}
        {typed === 0 && (
          <div className="alert alert-warn mt-md" role="note">
            <WarningIcon className="icon" />
            <div>
              <div className="title">{l.warnZeroTitle}</div>
              {fill(l.warnZeroBody, { name })}
            </div>
          </div>
        )}
        <p className="meta">{cap === null ? fill(l.recordedSet, { admin: adminName }) : fill(l.recordedChange, { admin: adminName, from: credits(cap) })}</p>
      </Dialog>
    </>
  );
}
