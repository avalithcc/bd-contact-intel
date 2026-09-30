import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { relativeTime } from "@/lib/i18n/format";
import { getFollowUpQueuePage } from "@/lib/followUp/queueQueries";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { PostponeMenu } from "./PostponeMenu";

export const dynamic = "force-dynamic";

/**
 * Per-BD daily follow-up queue (openspec/changes/follow-up-queue mockup:
 * follow-up-queue.html). Read-only shell: `getFollowUpQueuePage` both reads
 * today's already-materialized rows (the common case, one round trip) and,
 * on the first view of the Argentina calendar day only, lazily materializes
 * them first — see that function's doc comment for the round-trip budget.
 *
 * The quick-action icons deep-link into the contact record's existing
 * dialogs via `?openAction=` (approved mockup fallback note: "clicking an
 * action navigates to the record with that dialog open") — no dialog markup
 * is duplicated here. "Posponer"/"Omitir hoy" (PostponeMenu.tsx) are the
 * queue's own client component + server actions, since they mutate the
 * queue row itself rather than opening a contact-record dialog.
 */
export default async function FollowUpsPage() {
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const locale = await getLocale();
  const l = dict.followUpsPage;
  const qa = dict.contactRecord;

  const items = await getFollowUpQueuePage(me.id, new Date());
  const total = items.length;
  const pendingItems = items.filter((i) => i.state === "pending" && !i.workedToday);
  const workedCount = items.filter((i) => i.workedToday).length;
  const successWidth = total > 0 ? Math.round((workedCount / total) * 100) : 0;

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
      </div>

      {total > 0 && (
        <div className="row between wrap mb-lg" aria-label={l.progressAriaLabel(workedCount, total)}>
          <div className="row">
            <strong>{pendingItems.length}</strong>
            <span className="meta">{l.pendingSuffix(total)}</span>
          </div>
          <div className="bar-track" style={{ width: 220 }} role="img" aria-label={l.progressAriaLabel(workedCount, total)}>
            <span className="bar-success" style={{ width: `${successWidth}%` }} />
            <span className="bar-neutral" style={{ width: `${100 - successWidth}%` }} />
          </div>
        </div>
      )}

      {pendingItems.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <svg className="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <path d="m22 4-10 10.01-3-3" />
              </svg>
            </div>
            <h3>{l.emptyTitle}</h3>
            <p>{l.emptyBody}</p>
            <Link className="btn btn-secondary btn-sm" href="/contacts?view=uncontacted">
              {l.emptyCta}
            </Link>
          </div>
        </div>
      ) : (
        <div className="stack">
          {pendingItems.map((item) => {
            const name = [item.firstName, item.lastName].filter(Boolean).join(" ") || "—";
            const headline = item.jobTitle && item.companyName ? l.personHeadline(item.jobTitle, item.companyName) : null;
            return (
              <div className="card" key={item.id}>
                <div className="card-body row" style={{ gap: "var(--space-lg)" }}>
                  <Avatar id={item.personId} initials={initialsFromName(name)} />
                  <div className="grow stack-sm" style={{ minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: ".5rem" }}>
                      <Link className="strong" href={`/contacts/${item.personId}`}>
                        {name}
                      </Link>
                      <span className={statusBadgeClass(item.dueStatus)}>{dict.leadStatuses[item.dueStatus]}</span>
                    </div>
                    {headline && <p className="headline">{headline}</p>}
                    <div className="meta">{relativeTime(item.lastTouchAt, locale)}</div>
                  </div>
                  <div className="row wrap" role="toolbar" aria-label={l.ariaActionsFor(name)} style={{ justifyContent: "flex-end" }}>
                    <Link
                      className="btn btn-ghost btn-sm btn-icon"
                      href={`/contacts/${item.personId}#log-note`}
                      aria-label={qa.quickActionNote}
                      title={qa.quickActionNote}
                    >
                      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
                        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                      </svg>
                    </Link>
                    <Link
                      className="btn btn-ghost btn-sm btn-icon"
                      href={`/contacts/${item.personId}?openAction=call`}
                      aria-label={qa.quickActionCall}
                      title={qa.quickActionCall}
                    >
                      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </Link>
                    <Link
                      className="btn btn-ghost btn-sm btn-icon"
                      href={`/contacts/${item.personId}?openAction=email`}
                      aria-label={qa.quickActionEmail}
                      title={qa.quickActionEmail}
                    >
                      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-10 6L2 7" />
                      </svg>
                    </Link>
                    <Link
                      className="btn btn-ghost btn-sm btn-icon"
                      href={`/contacts/${item.personId}?openAction=task`}
                      aria-label={qa.quickActionTask}
                      title={qa.quickActionTask}
                    >
                      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    </Link>
                    <Link
                      className="btn btn-ghost btn-sm btn-icon"
                      href={`/contacts/${item.personId}?openAction=meeting`}
                      aria-label={qa.quickActionMeeting}
                      title={qa.quickActionMeeting}
                    >
                      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M16 2v4M8 2v4M3 10h18" />
                      </svg>
                    </Link>
                    <Link
                      className="btn btn-danger btn-icon btn-sm"
                      href={`/contacts/${item.personId}?openAction=discard`}
                      aria-label={qa.quickActionDiscard}
                      title={qa.quickActionDiscard}
                    >
                      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m15 9-6 6M9 9l6 6" />
                      </svg>
                    </Link>
                    <div className="row" style={{ gap: "var(--space-sm)" }}>
                      <Link className="btn btn-secondary btn-sm" href={`/contacts/${item.personId}`}>
                        {l.openRecord}
                      </Link>
                      <PostponeMenu
                        itemId={item.id}
                        labels={{
                          postponeMenuLabel: l.postponeMenuLabel,
                          postponeTomorrow: l.postponeTomorrow,
                          skipToday: l.skipToday,
                          postponeError: l.postponeError,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
