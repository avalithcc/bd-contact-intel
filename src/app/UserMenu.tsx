"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";

function initialsFrom(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Compact user menu rendered at the right end of the header on
 * authenticated pages. Collapses the language switcher, the
 * change-password link and sign-out into a single dropdown so the header
 * has room for the nav links.
 *
 * The locale-switcher form and the sign-out button are server-rendered
 * (they wire up server actions) and passed in as children/props from the
 * page, rather than reimplemented here.
 */
export function UserMenu({
  label,
  changePasswordHref,
  changePasswordLabel,
  localeSwitcher,
  signOutButton,
}: {
  label: string;
  changePasswordHref: string;
  changePasswordLabel: string;
  localeSwitcher: ReactNode;
  signOutButton: ReactNode;
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
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initialsFrom(label)}
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-locale" role="none">
            {localeSwitcher}
          </div>
          <Link
            className="user-menu-item"
            role="menuitem"
            href={changePasswordHref}
            onClick={() => setOpen(false)}
          >
            {changePasswordLabel}
          </Link>
          <div className="user-menu-item user-menu-signout" role="none">
            {signOutButton}
          </div>
        </div>
      )}
    </div>
  );
}
