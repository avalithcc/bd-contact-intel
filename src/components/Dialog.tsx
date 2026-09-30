"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal dialog (tasks.md mockup-parity 2.2; design-system.html /
 * mockups/styles.css `.overlay`/`.dialog`). Renders as `.overlay` >
 * `.dialog`, traps focus inside the dialog while open, closes on Esc or a
 * click on the overlay backdrop, and returns focus to whatever triggered
 * it when it closes.
 *
 * `wide` maps to the mockup's `.dialog.wide` modifier (720px vs 520px).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  // ReactNode (not `string`): the "Editar tarea" dialog (task-edit change)
  // renders a `badge-success` "Completada" chip next to its title
  // (mockup decision 5) — every other caller keeps passing a plain string,
  // which is itself a valid ReactNode.
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  // Disables the "×" close button, Escape and the overlay-backdrop click
  // (task-edit change, review fix WARNING #4; mockup's "Guardando…" swatch
  // shows the close button disabled) — every other caller omits this and
  // keeps today's always-closable behavior.
  closeDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Latest onClose, read by the focus/keyboard effect below without being
  // one of its dependencies. Callers pass a function declared in their render
  // (`function close() {…}`), which is a NEW function on every render; with
  // onClose in the effect's dependency list, every keystroke in a field that
  // updates the caller's state re-ran the effect, whose cleanup restores focus
  // and whose setup focuses the first focusable element — the close "×". The
  // owner could not type in "Nueva tarea": each key sent the caret to the ×.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Same "ref, not a dependency" reasoning as onCloseRef above: closeDisabled
  // flips true/false during the dialog's lifetime (e.g. while saving), and
  // must not re-run the keydown effect (which would re-trap/re-focus).
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;
  const titleId = `dialog-title-${useId()}`;

  // Body scroll lock: while the dialog is open, the page behind it
  // shouldn't scroll. Restore whatever value was set before (another
  // dialog, or a global style) rather than assuming "" is always correct.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const dialogEl = dialogRef.current;
    const focusables = dialogEl?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusables?.[0] ?? dialogEl)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (closeDisabledRef.current) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab" || !dialogEl) return;

      const items = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
    // Deliberately only `open`: initial focus and the focus trap are set up
    // once when the dialog opens, not on every parent render.
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="overlay open"
      onMouseDown={(e) => {
        if (closeDisabled) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`dialog${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm close"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={closeDisabled}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
