"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { CallIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { CALL_ATTEMPT_NOTE_MAX_LENGTH } from "@/lib/contacts/callAttempt";
import { mayOpenBar, mayRestoreBar } from "@/lib/contacts/callBarGuard";
import { recordCallAttemptAction, resolveCallAttemptAction } from "@/app/(app)/contacts/actions";

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
export function CallAttemptProvider({ labels, children }: { labels: CallAttemptLabels; children: React.ReactNode }) {
  const { showToast } = useToast();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [bar, setBar] = useState<OpenBar | null>(null);
  const [note, setNote] = useState("");
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
      recordCallAttemptAction(target.personId, target.number)
        .then((result) => {
          if (!result.ok) return showToast(labels.recordError, "error");
          // The attempt is recorded either way; the bar only belongs to the page that dialled.
          if (!mayOpenBar(pathnameAtDial, pathnameRef.current)) return;
          setNote("");
          openAttempt.current = result.attemptId;
          setBar({ attemptId: result.attemptId, personId: target.personId, personName: target.personName, step: "ask", busy: false });
        })
        .catch(() => showToast(labels.recordError, "error"))
        .finally(() => inFlight.current.delete(key));
    },
    [labels.recordError, showToast],
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
    </CallAttemptContext.Provider>
  );
}
