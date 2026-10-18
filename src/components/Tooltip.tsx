"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HelpCircleIcon } from "@/components/icons";
import { placeBubble, type BubblePlacement } from "@/lib/ui/tooltipPosition";

/**
 * Help tooltip built from the mockup's `.tip` pattern (gmail-sync-fleet/mockups/estado-gmail-equipo.html). The trigger is a
 * focusable span described by a `role="tooltip"` bubble that exists from the first client render (hidden while closed) so
 * `aria-describedby` resolves. It opens on hover or keyboard focus and closes on leave, blur or Esc (it follows the trigger when the page scrolls or resizes).
 *
 * The bubble is portaled to `document.body` and `position: fixed`, placed from the trigger's rectangle (tooltipPosition.ts):
 * the `overflow` of `.table-wrap` cannot clip it, and no sticky header's stacking context can paint over it. Static text
 * only: `title`, `body` (text or inline markup) and an optional `action` line (the caller owns the copy). This file exports
 * components only; the placement logic is a plain module.
 *
 * `variant="header"` adds the faint "?" icon for column headers; `align="end"` right-aligns the bubble to the trigger for
 * the last columns.
 */
export function Tooltip({
  title,
  body,
  action,
  actionLabel,
  variant = "inline",
  align = "start",
  children,
}: {
  title: string;
  body: ReactNode;
  action?: string;
  /** The label before `action`, e.g. "Qué hacer:". */
  actionLabel: string;
  variant?: "inline" | "header";
  align?: "start" | "end";
  children: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [place, setPlace] = useState<BubblePlacement | null>(null);
  const [mounted, setMounted] = useState(false);
  const open = (hover || focus) && !dismissed;

  useEffect(() => setMounted(true), []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    setPlace(
      placeBubble({
        trigger: trigger.getBoundingClientRect(),
        bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
      }),
    );
  }, [align]);

  useLayoutEffect(() => {
    if (open) reposition();
    else setPlace(null);
  }, [open, mounted, reposition]);

  // Scrolling or resizing (a focus can scroll the page) moves the trigger: follow it instead of closing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  return (
    <span
      className={`tip${variant === "header" ? " tip-hdr" : ""}`}
      onMouseEnter={() => {
        setHover(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHover(false)}
    >
      <span
        ref={triggerRef}
        className="tip-trigger"
        tabIndex={0}
        aria-describedby={id}
        onFocus={() => {
          setFocus(true);
          setDismissed(false);
        }}
        onBlur={() => setFocus(false)}
      >
        {children}
        {variant === "header" && <HelpCircleIcon className="icon tip-q" />}
      </span>
      {mounted &&
        createPortal(
          <span
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className="tip-bubble"
            hidden={!open}
            style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            <TooltipText title={title} body={body} action={action} actionLabel={actionLabel} />
          </span>,
          document.body,
        )}
    </span>
  );
}

/** The bubble's text: a bold title, the body and an optional "what to do" line. */
export function TooltipText({ title, body, action, actionLabel }: { title: string; body: ReactNode; action?: string; actionLabel: string }) {
  return (
    <>
      <strong>{title}</strong>
      <br />
      {body}
      {action && (
        <>
          <br />
          <strong>{actionLabel}</strong> {action}
        </>
      )}
    </>
  );
}
