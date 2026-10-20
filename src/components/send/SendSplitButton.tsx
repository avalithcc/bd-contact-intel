"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ClockIcon, SendIcon } from "@/components/icons";
import { buildAdvice } from "@/lib/sendSchedule/advice";
import type { Slot } from "@/lib/sendSchedule/time";
import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import { SchedulePopover, type ScheduleConfig } from "./SchedulePopover";
import { SendAdvice } from "./SendAdvice";

export interface CadenceOption {
  /** Shown as the item's second line, e.g. "Mañana mar 20 oct, 9:00 (Miami)". */
  hint: string;
  onPick: () => void;
}

/**
 * "Enviar ahora" + chevron menu ("Programar…", and in Sequences "Según la cadencia de la Secuencia"): the one send control
 * of the contact composer and of Sequences (mockup enviar-o-programar.html, section 1). The main part sends right away; the
 * menu opens the shared schedule popover. The component only reports the choice: the caller sends, schedules, approves and
 * words any error. While `error` is set the popover stays open with it, so a failed schedule never loses the BD's pick.
 *
 * Keyboard: Enter or Space opens the menu, arrows move, Escape closes it (then the popover) and returns focus to the chevron.
 */
export function SendSplitButton({
  labels: l,
  primaryLabel,
  small = false,
  disabled = false,
  busy = false,
  placement = "up",
  schedule,
  cadence = null,
  error = null,
  onSendNow,
  onSchedule,
}: {
  labels: SendControlLabels;
  primaryLabel: string;
  small?: boolean;
  disabled?: boolean;
  busy?: boolean;
  placement?: "up" | "down";
  schedule: ScheduleConfig;
  cadence?: CadenceOption | null;
  error?: string | null;
  onSendNow: () => void;
  onSchedule: (slot: Slot) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [initial, setInitial] = useState<Slot | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const chevRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const size = small ? " btn-sm" : "";

  useEffect(() => {
    if (!menuOpen && !popOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setPopOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen, popOpen]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  const closeAll = () => {
    setMenuOpen(false);
    setPopOpen(false);
    chevRef.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && (menuOpen || popOpen)) {
      // Not the dialog's Escape: the first one only closes what this control opened.
      e.stopPropagation();
      closeAll();
      return;
    }
    if (!menuOpen || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  // The note beside the button: where "now" falls for the recipient. Evaluated when rendered, which is when it matters.
  const nowAdvice = disabled ? null : buildAdvice(new Date(), schedule.recipients, schedule.fallbackZone);
  const openPopover = (from: Slot | null) => {
    setInitial(from);
    setMenuOpen(false);
    setPopOpen(true);
  };

  return (
    <span className="foot-anchor" ref={rootRef} onKeyDown={onKeyDown}>
      {nowAdvice && !popOpen && <SendAdvice labels={l} advice={nowAdvice} onUse={openPopover} />}
      <span className="anchor-split">
        <span className="btn-group split-btn" role="group" aria-label={l.groupLabel}>
          <button type="button" className={`btn btn-primary${size}`} disabled={disabled || busy} onClick={onSendNow}>
            <SendIcon className="icon" />
            {primaryLabel}
          </button>
          <button
            ref={chevRef}
            type="button"
            className={`btn btn-primary split-chev${size}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={l.moreOptions}
            disabled={disabled || busy}
            onClick={() => {
              setPopOpen(false);
              setMenuOpen((v) => !v);
            }}
          >
            <ChevronDownIcon className="icon" />
          </button>
        </span>
      </span>
      {menuOpen && (
        <div ref={menuRef} className={`menu${placement === "up" ? " up" : ""}`} role="menu">
          <button type="button" role="menuitem" className="menu-item mi" onClick={() => openPopover(null)}>
            <ClockIcon className="icon" />
            <span className="grow">
              <span className="mi-t">{l.scheduleItem}</span>
              <span className="mi-s">{l.scheduleItemHint}</span>
            </span>
          </button>
          {cadence && (
            <>
              <div className="menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="menu-item mi"
                onClick={() => {
                  setMenuOpen(false);
                  cadence.onPick();
                }}
              >
                <ClockIcon className="icon" />
                <span className="grow">
                  <span className="mi-t">{l.cadenceItem}</span>
                  <span className="mi-s">{cadence.hint}</span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
      {popOpen && (
        <SchedulePopover
          labels={l}
          config={{ ...schedule, initial: initial ?? schedule.initial }}
          placement={placement}
          busy={busy}
          error={error}
          onClose={closeAll}
          onSubmit={onSchedule}
        />
      )}
    </span>
  );
}
