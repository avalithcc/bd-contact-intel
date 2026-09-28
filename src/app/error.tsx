"use client";

import { useEffect } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { WarningIcon } from "@/components/icons";

/**
 * Root-level error boundary (fix/robustness) — catches an unhandled render
 * error anywhere OUTSIDE `(app)` that doesn't have its own boundary, chiefly
 * the `(auth)` group (`/login`, `/account/password`), which has no
 * sidebar/topbar chrome to preserve (see `(auth)/layout.tsx`). Does NOT
 * catch errors thrown by `layout.tsx` (this file's own parent) — that class
 * of failure is `global-error.tsx`'s job.
 *
 * Uses `.auth`'s full-viewport centered layout (design-system.css) — the
 * app's own existing "standalone page, no chrome" pattern — instead of
 * inventing a new one, same as `(app)/error.tsx` reuses `.empty`.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const l = t(DEFAULT_LOCALE).errorBoundary;

  useEffect(() => {
    console.error("[root] unhandled render error", error);
  }, [error]);

  return (
    <div className="auth">
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
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
    </div>
  );
}
