"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircleIcon } from "@/components/icons";
import { placeBubble, type BubblePlacement } from "@/lib/ui/tooltipPosition";

/**
 * Help tooltip built from the mockup's `.tip` pattern (gmail-sync-fleet/mockups/estado-gmail-equipo.html). The trigger is a
 * focusable span described by a `role="tooltip"` bubble that is always in the markup (hidden while closed) so
 * `aria-describedby` resolves. It opens on hover or keyboard focus and closes on leave, blur, Esc, scroll or resize.
 *
 * The bubble is `position: fixed`, placed from the trigger's rectangle (tooltipPosition.ts), so the `overflow` of
 * `.table-wrap` cannot clip it. Static text only: `title`, `body` and an optional `action` line, all plain strings (the
 * caller owns the copy). This file exports components only; the placement logic is a plain module.
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
  body: string;
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
  const open = (hover || focus) && !dismissed;

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!open || !trigger || !bubble) {
      setPlace(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPlace(
      placeBubble({
        trigger: rect,
        bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
      }),
    );
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setDismissed(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

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
      <span
        ref={bubbleRef}
        id={id}
        role="tooltip"
        className="tip-bubble"
        hidden={!open}
        style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" }}
      >
        <strong>{title}</strong>
        <br />
        {body}
        {action && (
          <>
            <br />
            <strong>{actionLabel}</strong> {action}
          </>
        )}
      </span>
    </span>
  );
}
