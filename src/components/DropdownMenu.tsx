"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Generic accessible dropdown menu (tasks.md mockup-parity 3.1/3.2),
 * matching mockups' `.dropdown`/`.menu` pattern (design-system.html) behind
 * a real focus-managed button instead of the mockup's `<details>` element,
 * so it follows the same keyboard contract as the existing `UserMenu`
 * (src/app/UserMenu.tsx): `aria-haspopup`/`aria-expanded` on the trigger,
 * Escape closes and returns focus to the trigger, and a click outside
 * closes it. Kept generic so both the TopBar "Crear" menu and the account
 * menu share one implementation instead of two near-duplicates.
 *
 * mockup-port 02: renders the mockup's own `.dropdown`/`.menu`/`.menu.left`
 * global classes (design-system.css) instead of a dedicated CSS module —
 * same component, same behavior, now pixel-matched to design-system.html.
 */
export function DropdownMenu({
  trigger,
  triggerClassName,
  ariaLabel,
  align = "right",
  children,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  ariaLabel?: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`menu${align === "left" ? " left" : ""}`}
          onClick={(e) => {
            // Menu items are links/buttons that navigate or act on click —
            // close the menu right after so it doesn't linger over the
            // destination page.
            if ((e.target as HTMLElement).closest("a,button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
