import Link from "next/link";
import { t } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { WarningIcon } from "@/components/icons";

/**
 * Root `not-found.tsx` (fix/robustness) — catches a truly unmatched top-level
 * path (e.g. `/nonsense`) that doesn't resolve into either the `(app)` or
 * `(auth)` route group, so `(app)/not-found.tsx` never gets a chance to run
 * (its layout never matched). See that sibling file's doc comment for the
 * segment-scoped 404s this one does NOT need to handle.
 */
export default function RootNotFound() {
  const l = t(DEFAULT_LOCALE).notFoundPage;

  return (
    <div className="auth">
      <div className="card" style={{ maxWidth: 420, width: "100%" }}>
        <div className="empty">
          <div className="empty-icon">
            <WarningIcon className="icon-lg" />
          </div>
          <h3>{l.title}</h3>
          <p>{l.body}</p>
          <Link href="/" className="btn btn-secondary btn-sm">
            {l.backHome}
          </Link>
        </div>
      </div>
    </div>
  );
}
