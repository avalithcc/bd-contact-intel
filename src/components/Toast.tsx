"use client";

export type ToastVariant = "success" | "error";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Single toast (tasks.md mockup-parity 2.3; design-system.html "toast" /
 * mockups/styles.css `.toast`/`.toast .ok`). The mockup only specifies a
 * success icon (`.ok`, tinted with `--color-on-dark-success`); the error
 * variant (`.err`) reuses the existing `--color-on-dark-link` on-dark
 * reddish tone since no dedicated on-dark error token exists yet.
 */
export function Toast({
  toast,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  return (
    <div
      className="toast"
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocus={() => onPause(toast.id)}
      onBlur={() => onResume(toast.id)}
    >
      {toast.variant === "success" ? (
        <svg className="icon ok" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="m22 4-10 10.01-3-3" />
        </svg>
      ) : (
        <svg className="icon err" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      )}
      <span>{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            toast.onAction?.();
          }}
        >
          {toast.actionLabel}
        </a>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm close"
        aria-label="Cerrar"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}
