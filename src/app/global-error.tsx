"use client";

import { useEffect } from "react";
import { t } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import "./globals.css";
import "./design-system.css";

/**
 * Last-resort error boundary (fix/robustness) — the only one that fires when
 * the ROOT `layout.tsx` itself throws, since a segment's `error.tsx` never
 * catches an error from its own parent layout. Per the Next.js contract,
 * this file REPLACES the root layout when active, so it must render its own
 * `<html>`/`<body>` and re-import the global stylesheets directly (the
 * layout that would normally do that didn't render) — otherwise this would
 * be the one page in the app with no styling at all, which is exactly the
 * "looks broken" failure this fix exists to avoid.
 *
 * No `<Link>` here on purpose: this is the one boundary where even the
 * Next.js router may be in a broken state, so "back home" is a plain
 * anchor tag, not client-side navigation.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const l = t(DEFAULT_LOCALE).errorBoundary;

  useEffect(() => {
    console.error("[global] unhandled root error", error);
  }, [error]);

  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <div className="auth">
          <div className="card" style={{ maxWidth: 420, width: "100%" }}>
            <div className="empty">
              <h3>{l.title}</h3>
              <p>{l.body}</p>
              <div className="row row-lg" style={{ justifyContent: "center" }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => reset()}>
                  {l.retry}
                </button>
                <a href="/" className="btn btn-secondary btn-sm">
                  {l.backHome}
                </a>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
