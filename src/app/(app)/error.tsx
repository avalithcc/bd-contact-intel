"use client";

import { useEffect } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { WarningIcon } from "@/components/icons";

/**
 * Route-level error boundary for the authenticated app area (fix/robustness).
 *
 * Before this file existed there was NO error boundary anywhere in the app —
 * a Server Component render error (e.g. the company record page passing a
 * formatter function into a client component, a real incident) fell through
 * to Next's own generic default error UI while still answering 200, and
 * nobody noticed for a day. `error.tsx` here is the fix: it wraps every page
 * under `(app)` (see `../layout.tsx`), so the BD sees an on-brand message
 * with a real way out instead of Next's bare fallback, AND the error is
 * still logged (see the effect below) instead of disappearing silently —
 * that second part matters as much as the first: a boundary that swallows
 * the error just makes the next bug exactly as invisible as this one was.
 *
 * Rendered as `children` inside `AppLayout` (mockup-port c03's shared shell),
 * so the sidebar/topbar chrome stays on screen and only the content pane
 * is replaced — a BD who hits this can still navigate away normally.
 *
 * Must be a Client Component ("use client" — the Next.js contract for
 * `error.tsx`) and therefore cannot call the async `getDictionary()`
 * (cookie-based locale read). It uses `t(DEFAULT_LOCALE)` instead — the same
 * plain, synchronous dictionary lookup `LoginForm.tsx` already uses from a
 * client component — which is safe here because the product ships
 * Spanish-only (see `DEFAULT_LOCALE`'s own doc comment).
 *
 * Markup reuses `.empty`/`.empty-icon` verbatim from the mockups' own error
 * state (design-system.html:86 — "No se pudieron cargar los contactos" /
 * WarningIcon / "Reintentar"), the one mockup screen that actually shows
 * this state. The one deviation: that mockup instance is a single scoped
 * widget with one "Reintentar" button; this boundary is a whole-page
 * failure, so it adds a second, secondary link back to a known-good page
 * (per this fix's spec) rather than trapping the BD with retry as the only
 * option.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const l = t(DEFAULT_LOCALE).errorBoundary;

  useEffect(() => {
    // Reaches the browser console unconditionally. When this boundary
    // catches a Server Component render error, Next has already logged the
    // original error server-side (Vercel runtime logs) before this ever
    // mounts on the client — this call is the client-side half, and the one
    // guarantee that NEITHER half of this incident's original failure mode
    // (an error the BD saw as a plain 200) can repeat unnoticed.
    console.error("[app] unhandled render error", error);
  }, [error]);

  return (
    <main>
      <div className="page">
        <div className="empty">
          <div className="empty-icon">
            <WarningIcon className="icon-lg" />
          </div>
          <h3>{l.title}</h3>
          <p>{l.body}</p>
          <div className="row row-lg" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => reset()}>
              {l.retry}
            </button>
            <Link href="/" className="btn btn-secondary btn-sm">
              {l.backHome}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
