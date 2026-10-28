"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { WhatsAppIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { mayRestoreBar } from "@/lib/contacts/callBarGuard";
import { logWhatsAppAction } from "@/app/(app)/contacts/actions";
import type { WhatsAppOutcomeCode } from "@/lib/contacts/whatsapp";

export interface WhatsAppBarLabels {
  barLabel: string;
  question: string;
  replied: string;
  sent: string;
  noWhatsapp: string;
  saved: string;
  noChannelSaved: string;
  saveError: string;
}

export interface WhatsAppTarget {
  personId: string;
  personName: string;
}

interface OpenBar extends WhatsAppTarget {
  id: number;
  busy: boolean;
}

const WhatsAppBarContext = createContext<{ openBar: (target: WhatsAppTarget) => void } | null>(null);

/** `null` outside the provider: the link then behaves as a plain `wa.me` link. */
export function useWhatsAppBar() {
  return useContext(WhatsAppBarContext);
}

/**
 * The `wa.me` link of PhoneValue. The click still opens the chat, untouched, and additionally opens the outcome bar.
 * Unlike a `tel:` click it writes NOTHING: a dialled number is evidence (call_attempt), an opened chat is not, and the
 * design has no WhatsApp attempt type. Only the bar's three buttons write.
 */
export function WhatsAppLink({ href, className, title, ariaLabel, personId, personName, children }: {
  href: string;
  className?: string;
  title: string;
  ariaLabel: string;
  personId?: string;
  personName?: string;
  children: React.ReactNode;
}) {
  const bar = useWhatsAppBar();
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={ariaLabel}
      onClick={() => {
        if (bar && personId) bar.openBar({ personId, personName: personName ?? "" });
      }}
    >
      {children}
    </a>
  );
}

/** Button order follows the mockup: "Me contestó" is the primary one. */
const BAR_ORDER = ["replied", "sent", "no_whatsapp"] as const satisfies readonly WhatsAppOutcomeCode[];
const BAR_LABEL_KEY = { replied: "replied", sent: "sent", no_whatsapp: "noWhatsapp" } as const satisfies Record<WhatsAppOutcomeCode, keyof WhatsAppBarLabels>;

/**
 * Mounted once in the app shell, next to CallAttemptProvider (whatsapp-como-actividad mockup, section 1). Having BOTH
 * this one-tap bar and the "WhatsApp" quick-action dialog is deliberate and mirrors calls (CallAttemptProvider plus
 * CallForm): the bar is the fast path, the dialog is for when a date or notes are needed.
 *
 * The call bar's `mayRestoreBar` is reused as is (it only compares two ids); `mayOpenBar` is not needed because nothing
 * async happens before this bar opens.
 */
export function WhatsAppBarProvider({ labels, children }: { labels: WhatsAppBarLabels; children: React.ReactNode }) {
  const { showToast } = useToast();
  const pathname = usePathname();
  const [bar, setBar] = useState<OpenBar | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const nextId = useRef(0);
  const openId = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    openId.current = null;
    setBar(null);
  }, []);

  // Same fixed stack the toasts and the call bar live in.
  useEffect(() => setRegion(document.getElementById("toast-region")), []);
  useEffect(dismiss, [pathname, dismiss]);
  useEffect(() => {
    if (bar) firstRef.current?.focus();
  }, [bar?.id]);

  useEffect(() => {
    if (!bar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body && !barRef.current?.contains(active)) return;
      dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bar, dismiss]);

  /**
   * Contacts with a write in flight. `bar.busy` cannot carry this: re-clicking the SAME person's wa link replaces the
   * bar with a fresh `busy: false` one, and the BD could then press a second outcome while the first write was still
   * running — two activities for one conversation, e.g. `replied` AND `sent`, which then both feed status derivation
   * and the Seguimientos cycle. The lock has to live per PERSON, outside the bar object. Same idea as
   * CallAttemptProvider's own in-flight set.
   */
  const inFlight = useRef<Set<string>>(new Set());

  const openBar = useCallback((target: WhatsAppTarget) => {
    // Ignore the click while this contact is being written: the busy bar already on screen is the truthful one.
    if (inFlight.current.has(target.personId)) return;
    const id = ++nextId.current;
    openId.current = id;
    setBar({ ...target, id, busy: false });
  }, []);

  async function answer(outcome: WhatsAppOutcomeCode) {
    if (!bar || bar.busy || inFlight.current.has(bar.personId)) return;
    const open = bar;
    inFlight.current.add(open.personId);
    setBar({ ...open, busy: true });
    let ok = false;
    try {
      // Blank date and time: the entry is dated now. A date or notes go through the quick-action dialog instead.
      ok = (await logWhatsAppAction(open.personId, outcome, "", "", "")).ok;
    } catch {
      ok = false;
    }
    inFlight.current.delete(open.personId);
    if (ok) {
      // Dismiss ONLY the bar this write belongs to. A slow write for contact A used to close whatever bar was on
      // screen by then — typically contact B's, opened meanwhile — and tell the BD that B was saved.
      if (openId.current === open.id) dismiss();
      showToast(outcome === "no_whatsapp" ? labels.noChannelSaved : labels.saved);
    } else if (mayRestoreBar(openId.current === null ? null : String(openId.current), String(open.id))) {
      setBar({ ...open, busy: false });
      showToast(labels.saveError, "error");
    } else {
      // The bar is gone (navigation, or another contact's bar took its place). Still say it failed: silence here
      // leaves the BD believing a WhatsApp was logged when nothing was written.
      showToast(labels.saveError, "error");
    }
  }

  return (
    <WhatsAppBarContext.Provider value={{ openBar }}>
      {children}
      {bar &&
        region &&
        createPortal(
          <div className="outcome" ref={barRef} role="status" aria-label={labels.barLabel}>
            <WhatsAppIcon className="icon" />
            <span>
              <span className="who">{bar.personName}</span> · {labels.question}
            </span>
            <span className="acts">
              {BAR_ORDER.map((outcome, i) => (
                <button
                  key={outcome}
                  ref={i === 0 ? firstRef : undefined}
                  className={i === 0 ? "obtn primary" : "obtn"}
                  type="button"
                  disabled={bar.busy}
                  onClick={() => answer(outcome)}
                >
                  {labels[BAR_LABEL_KEY[outcome]]}
                </button>
              ))}
            </span>
          </div>,
          region,
        )}
    </WhatsAppBarContext.Provider>
  );
}
