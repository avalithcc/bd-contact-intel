"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { CallForm } from "@/components/CallForm";
import type { CallFormLabels } from "@/lib/contacts/callFormLabels";
import { callDialogDefaults, followUpTitle } from "@/lib/contacts/callDialog";
import { settleAction } from "@/lib/contacts/actionOutcome";
import { CallIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { CALL_ATTEMPT_NOTE_MAX_LENGTH } from "@/lib/contacts/callAttempt";
import { mayOpenBar, mayRestoreBar } from "@/lib/contacts/callBarGuard";
import type { DialledField } from "@/lib/contacts/callAttempt";
import { addContactTaskAction, recordCallAttemptAction, resolveCallAttemptAction, settleCallAttemptAction } from "@/app/(app)/contacts/actions";

export interface CallAttemptLabels {
  barLabel: string;
  question: string;
  spoke: string;
  noAnswer: string;
  voicemail: string;
  noteLabel: string;
  save: string;
  callSaved: string;
  attemptSaved: string;
  recordError: string;
  saveError: string;
  calling: string;
  details: string;
  dialLine: string;
  followUpToggle: string;
  followUpTitleLabel: string;
  followUpDueLabel: string;
  followUpTitleDefault: string;
  followUpError: string;
  followUpSaved: string;
}

/** Strings of the "Más detalles…" dialog, picked from the record dictionary by the shell. */
export interface CallDetailsLabels {
  form: CallFormLabels;
  phone: string;
  mobile: string;
}

export interface CallTarget {
  personId: string;
  personName: string;
  /** The stored number exactly as shown; the server checks it belongs to the contact. */
  number: string;
}

interface OpenBar {
  attemptId: string;
  personId: string;
  personName: string;
  step: "ask" | "note";
  busy: boolean;
  number: string;
  field: DialledField;
}

const CallAttemptContext = createContext<{ startCall: (target: CallTarget) => void } | null>(null);

/** `null` outside the provider: the link then behaves as a plain `tel:` link. */
export function useCallAttempt() {
  return useContext(CallAttemptContext);
}

/**
 * Mounted once in the app shell. The `tel:` click records the attempt, then
 * this bar asks the outcome (call-logging-one-tap, variant A). It never blocks
 * and never nags: leaving the page (or Escape) drops the bar, and the attempt
 * simply stays without an outcome.
 */
export function CallAttemptProvider({
  labels,
  details: detailLabels,
  children,
}: {
  labels: CallAttemptLabels;
  details: CallDetailsLabels;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [bar, setBar] = useState<OpenBar | null>(null);
  const [note, setNote] = useState("");
  // "Más detalles…": the full call form, for the attempt the bar was asking about.
  const [detail, setDetail] = useState<{ bar: OpenBar; now: Date; busy: boolean; error: string | null } | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const inFlight = useRef(new Set<string>());
  // The attempt whose bar is open right now; null once dismissed or left behind.
  const openAttempt = useRef<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const spokeRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    openAttempt.current = null;
    setBar(null);
  }, []);

  // The bar lives in the toast region ToastProvider already renders (one fixed
  // stack, one live region) instead of a second region stacked on top of it.
  useEffect(() => setRegion(document.getElementById("toast-region")), []);

  useEffect(dismiss, [pathname, dismiss]);
  useEffect(() => setDetail(null), [pathname]);

  // Announce by moving focus to the first answer when the bar opens.
  useEffect(() => {
    if (bar?.step === "ask") spokeRef.current?.focus();
  }, [bar?.attemptId, bar?.step]);

  useEffect(() => {
    if (!bar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Escape meant for a menu or dialog (focus lives inside it) is not ours.
      const active = document.activeElement;
      if (active && active !== document.body && !barRef.current?.contains(active)) return;
      dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bar, dismiss]);

  const startCall = useCallback(
    (target: CallTarget) => {
      const key = `${target.personId}|${target.number}`;
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      const pathnameAtDial = pathnameRef.current;
      showToast(labels.calling);
      recordCallAttemptAction(target.personId, target.number)
        .then((result) => {
          if (!result.ok) return showToast(labels.recordError, "error");
          // The attempt is recorded either way; the bar only belongs to the page that dialled.
          if (!mayOpenBar(pathnameAtDial, pathnameRef.current)) return;
          setNote("");
          openAttempt.current = result.attemptId;
          setBar({
            attemptId: result.attemptId,
            personId: target.personId,
            personName: target.personName,
            step: "ask",
            busy: false,
            number: target.number,
            field: result.field,
          });
        })
        .catch(() => showToast(labels.recordError, "error"))
        .finally(() => inFlight.current.delete(key));
    },
    [labels.calling, labels.recordError, showToast],
  );

  async function answer(outcome: "connected" | "no_answer" | "voicemail") {
    if (!bar || bar.busy) return;
    const open = bar;
    setBar({ ...open, busy: true });
    let ok = false;
    try {
      ok = (await resolveCallAttemptAction(open.attemptId, open.personId, outcome, outcome === "connected" ? note : "")).ok;
    } catch {
      ok = false;
    }
    if (ok) {
      dismiss();
      showToast(outcome === "connected" ? labels.callSaved : labels.attemptSaved);
    } else if (mayRestoreBar(openAttempt.current, open.attemptId)) {
      setBar({ ...open, busy: false });
      showToast(labels.saveError, "error");
    }
  }

  async function submitDetails(values: Parameters<React.ComponentProps<typeof CallForm>["onSubmit"]>[0]) {
    if (!detail || detail.busy) return;
    const { bar: open } = detail;
    setDetail({ ...detail, busy: true, error: null });
    const result = await settleAction(() => settleCallAttemptAction(open.attemptId, open.personId, values.outcome, values.date, values.time, values.notes));
    if (!result.ok) {
      if (result.reason === "unconfirmed") router.refresh();
      const message = result.reason === "call_occurred_at_in_future" ? detailLabels.form.errorCallOccurredAtInFuture : labels.saveError;
      setDetail({ ...detail, busy: false, error: message });
      return showToast(message, "error");
    }
    setDetail(null);
    showToast(labels.callSaved);
    if (values.followUp) {
      const due = values.followUp.dueDate ? new Date(values.followUp.dueDate) : undefined;
      const task = await settleAction(() => addContactTaskAction(open.personId, values.followUp!.title, due));
      showToast(task.ok ? labels.followUpSaved : labels.followUpError, task.ok ? "success" : "error");
    }
    router.refresh();
  }

  return (
    <CallAttemptContext.Provider value={{ startCall }}>
      {children}
      {bar &&
        region &&
        createPortal(
          <div className="outcome" ref={barRef} role="status" aria-label={labels.barLabel}>
            <CallIcon className="icon" />
            {bar.step === "ask" ? (
              <>
                <span>
                  <span className="who">{bar.personName}</span> · {labels.question}
                </span>
                <span className="acts">
                  <button ref={spokeRef} className="obtn primary" type="button" disabled={bar.busy} onClick={() => setBar({ ...bar, step: "note" })}>
                    {labels.spoke}
                  </button>
                  <button className="obtn" type="button" disabled={bar.busy} onClick={() => answer("no_answer")}>
                    {labels.noAnswer}
                  </button>
                  <button className="obtn" type="button" disabled={bar.busy} onClick={() => answer("voicemail")}>
                    {labels.voicemail}
                  </button>
                  <button
                    className="obtn"
                    type="button"
                    disabled={bar.busy}
                    onClick={() => {
                      setDetail({ bar, now: new Date(), busy: false, error: null });
                      dismiss();
                    }}
                  >
                    {labels.details}
                  </button>
                </span>
              </>
            ) : (
              <form
                className="onote-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void answer("connected");
                }}
              >
                <span className="who">{bar.personName}</span>
                <input
                  className="onote"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={labels.noteLabel}
                  aria-label={labels.noteLabel}
                  maxLength={CALL_ATTEMPT_NOTE_MAX_LENGTH}
                  autoFocus
                />
                <button className="obtn primary" type="submit" disabled={bar.busy}>
                  {labels.save}
                </button>
              </form>
            )}
          </div>,
          region,
        )}
      {detail && (
        <CallForm
          labels={detailLabels.form}
          busy={detail.busy}
          error={detail.error && <div className="error-text" role="alert">{detail.error}</div>}
          onCancel={() => setDetail(null)}
          onSubmit={submitDetails}
          dial={{
            line: labels.dialLine,
            name: detail.bar.personName,
            number: detail.bar.number,
            fieldLabel: detail.bar.field === "mobile_phone" ? detailLabels.mobile : detailLabels.phone,
            ...callDialogDefaults(detail.now),
            followUp: {
              toggleLabel: labels.followUpToggle,
              titleLabel: labels.followUpTitleLabel,
              dueLabel: labels.followUpDueLabel,
              title: followUpTitle(labels.followUpTitleDefault, detail.bar.personName),
              dueDate: callDialogDefaults(detail.now).followUpDue,
            },
          }}
        />
      )}
    </CallAttemptContext.Provider>
  );
}
