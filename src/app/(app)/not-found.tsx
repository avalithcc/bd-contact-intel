import Link from "next/link";
import { t } from "@/lib/i18n/dictionaries";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { WarningIcon } from "@/components/icons";

/**
 * `(app)` segment's `notFound()` boundary (fix/robustness). Several pages
 * already call `notFound()` for a missing/merged-away record (e.g.
 * `contacts/[id]/page.tsx`, `leads/[id]/page.tsx`, the admin screens'
 * non-admin 404) but the app had no `not-found.tsx` anywhere, so every one
 * of those fell through to Next's bare default 404 instead of an on-brand
 * page. Placed at this segment (not only at the root — see `../not-found.tsx`)
 * so those calls render inside `AppLayout`'s sidebar/topbar chrome, same
 * reasoning as `./error.tsx`.
 *
 * A plain Server Component (no client interactivity needed here, unlike
 * `error.tsx`'s `reset()`), so it reads the dictionary via the same
 * synchronous `t(DEFAULT_LOCALE)` used by other server-renderable copy for
 * consistency with the sibling boundary, rather than mixing in the async
 * `getDictionary()` for a one-off case.
 */
export default function AppNotFound() {
  const l = t(DEFAULT_LOCALE).notFoundPage;

  return (
    <main>
      <div className="page">
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
    </main>
  );
}
