"use client";

import { useEffect, useRef, useState } from "react";
import type { SendControlLabels } from "@/lib/sendSchedule/labels";
import type { Slot } from "@/lib/sendSchedule/time";
import { SchedulePopover, type ScheduleConfig } from "./SchedulePopover";
import { useInFlight } from "./useInFlight";

/**
 * A plain button that opens the shared schedule popover ("Cambiar" on an approved card, mockup section 4). Same popover as the
 * split button; the caller decides what saving means and answers `true` when it worked, which closes the popover. A failure
 * keeps it open with `error`, so the pick is not lost. Escape and a click outside close it and return focus to the button.
 */
export function ScheduleButton({
  labels: l,
  label,
  className,
  disabled = false,
  title,
  busy = false,
  error = null,
  placement = "down",
  schedule,
  onSchedule,
}: {
  labels: SendControlLabels;
  label: string;
  className: string;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
  error?: string | null;
  placement?: "up" | "down";
  schedule: ScheduleConfig;
  onSchedule: (slot: Slot) => Promise<boolean | void> | boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flight = useInFlight();
  const working = busy || flight.kind !== null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <span
      className="foot-anchor"
      ref={rootRef}
      data-busy={flight.kind ? "true" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation(); // see SendSplitButton: React's root and the Dialog listener share `document`
          close();
        }
      }}
    >
      <button ref={buttonRef} type="button" className={className} disabled={disabled || working} aria-busy={working ? "true" : undefined} title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {flight.kind && <span className="spinner" aria-hidden="true" />}
        {flight.kind ? l.scheduling : label}
      </button>
      {open && (
        <SchedulePopover
          labels={l}
          config={schedule}
          placement={placement}
          busy={working}
          error={error}
          onClose={close}
          onSubmit={async (slot) => {
            if ((await flight.run("schedule", () => onSchedule(slot))) === true) setOpen(false);
          }}
        />
      )}
    </span>
  );
}
