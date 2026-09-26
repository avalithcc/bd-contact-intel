"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Compact user menu rendered at the right end of the header on
 * authenticated pages. Collapses the language switcher, the
 * change-password link and sign-out into a single dropdown so the header
 * has room for the nav links.
 *
 * The sign-out button is server-rendered (it wires up a server action) and
 * passed in as a prop from the page, rather than reimplemented here.
 */
export function UserMenu({
  label,
  changePasswordHref,
  changePasswordLabel,
  signOutButton,
}: {
  label: string;
  changePasswordHref: string;
  changePasswordLabel: string;
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
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <UserIcon />
        <ChevronIcon />
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-name" role="none">
            {label}
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
